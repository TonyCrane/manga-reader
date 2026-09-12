import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { mapConcurrent } from "./concurrency";
import {
  chapterProcessingVersion,
  hash,
  outputsExist,
  processChapter,
} from "./images";
import { db, mangaDir } from "./db";
import { errorMessage, log } from "./log";

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

const extensions = /\.(jpe?g|png|webp|avif|tiff?|gif)$/i;

export async function safeDirectory(input: string) {
  const root = await fs.realpath(mangaDir);
  const resolved = await fs.realpath(path.resolve(root, input));
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw Error("目录必须位于素材挂载目录内");
  }
  if (!(await fs.stat(resolved)).isDirectory()) {
    throw Error("请选择目录");
  }
  return resolved;
}

async function dirs(p: string, includeHidden = false) {
  return (await fs.readdir(p, { withFileTypes: true }))
    .filter(
      (entry) =>
        entry.isDirectory() && (includeHidden || !entry.name.startsWith(".")),
    )
    .map((entry) => path.join(p, entry.name))
    .sort(compare);
}

async function files(p: string) {
  const entries = await fs.readdir(p, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && extensions.test(e.name))
    .map((e) => path.join(p, e.name))
    .sort(compare);
}

export const relativePath = async (p: string) =>
  path.relative(await fs.realpath(mangaDir), p) || ".";

export async function browse(input: string) {
  const p = await safeDirectory(input || ".");
  return {
    path: p,
    root: await fs.realpath(mangaDir),
    directories: await dirs(p, true),
  };
}

type Source = { id: string; path: string; mode: string };

export type RefreshMode = "all" | "new";

type Plan = {
  mangaPath: string;
  author?: string;
  chapters: { path: string; files: string[] | null }[];
};

let busy = false;

export function startImport(source: Source, mode: RefreshMode = "all") {
  if (busy) {
    throw Error("已有导入任务正在进行");
  }
  busy = true;
  const id = crypto.randomUUID();
  db.prepare(
    "INSERT INTO jobs(id,source_id,status,message) VALUES(?,?,'running','正在扫描目录')",
  ).run(id, source.id);
  log.info("import.started", "导入任务已启动", {
    jobId: id,
    sourceId: source.id,
    sourcePath: source.path,
    sourceMode: source.mode,
    refreshMode: mode,
  });
  void run(source, id, mode)
    .catch((error) => {
      const message = errorMessage(error);
      db.prepare("UPDATE jobs SET status='failed',error=? WHERE id=?").run(
        message,
        id,
      );
      log.error("import.failed", "导入任务失败", {
        jobId: id,
        sourceId: source.id,
        sourcePath: source.path,
        error: message,
      });
    })
    .finally(() => {
      busy = false;
    });
  return id;
}

async function run(source: Source, id: string, mode: RefreshMode) {
  const startedAt = Date.now();
  const root = await safeDirectory(source.path);
  let candidates: { p: string; author?: string }[] = [];
  if (source.mode === "manual") {
    candidates = [{ p: root }];
  } else if (source.mode === "one") {
    candidates = (await dirs(root)).map((p) => ({ p }));
  } else {
    const groups = await mapConcurrent(await dirs(root), 8, async (author) =>
      (await dirs(author)).map((p) => ({
        p,
        author: path.basename(author),
      })),
    );
    candidates = groups.flat();
  }
  const materialRoot = await fs.realpath(mangaDir);
  const relative = (p: string) => path.relative(materialRoot, p) || ".";
  const existingChapters = new Set(
    (db.prepare("SELECT path FROM chapters").all() as { path: string }[]).map(
      (chapter) => chapter.path,
    ),
  );
  const scanned = await mapConcurrent(candidates, 8, async ({ p, author }) => {
    // Enumerate chapter names, but never enter known chapter image directories in new-only mode.
    const children = await dirs(p);
    const chapterDirs = children.length ? children : [p];
    const chapters: Plan["chapters"] = [];
    for (const cp of chapterDirs) {
      if (mode === "new" && existingChapters.has(relative(cp))) {
        chapters.push({ path: cp, files: null });
        continue;
      }
      const images = await files(cp);
      if (images.length) {
        chapters.push({ path: cp, files: images });
      }
    }
    return { mangaPath: p, author, chapters };
  });
  const plans = scanned.filter((plan) => plan.chapters.length);
  const total = plans.reduce(
    (n, p) => n + p.chapters.reduce((n, c) => n + (c.files?.length || 0), 0),
    0,
  );
  log.info("import.scanned", "导入目录扫描完成", {
    jobId: id,
    sourceId: source.id,
    mangaCount: plans.length,
    chapterCount: plans.reduce(
      (count, plan) => count + plan.chapters.length,
      0,
    ),
    imageCount: total,
  });
  let done = 0;
  let reused = 0;
  let skippedChapters = 0;
  let lastProgress = 0;
  const progress = (message: string, force = false) => {
    const now = Date.now();
    if (force || now - lastProgress >= 100) {
      db.prepare("UPDATE jobs SET done=?,message=? WHERE id=?").run(
        done,
        message,
        id,
      );
      lastProgress = now;
    }
  };
  db.prepare("UPDATE jobs SET total=? WHERE id=?").run(total, id);
  for (const plan of plans) {
    const mangaPath = relative(plan.mangaPath);
    const scannedTitle = path.basename(plan.mangaPath);
    const mid =
      (db.prepare("SELECT id FROM manga WHERE path=?").get(mangaPath) as any)
        ?.id || hash(mangaPath);
    db.transaction(() => {
      db.prepare(
        `
        INSERT OR IGNORE INTO manga(id,path,title,author,tags)
        VALUES(?,?,?,?,?)
        `,
      ).run(mid, mangaPath, scannedTitle, plan.author || "", "[]");
      db.prepare("INSERT OR IGNORE INTO manga_sources VALUES(?,?)").run(
        mid,
        source.id,
      );
      db.prepare("DELETE FROM manga_users WHERE manga_id = ?").run(mid);
      db.prepare("UPDATE manga SET scanned_title=? WHERE id=?").run(
        scannedTitle,
        mid,
      );
      if (plan.author) {
        db.prepare(
          "UPDATE manga SET author=? WHERE id=? AND COALESCE(author,'')=''",
        ).run(plan.author, mid);
        db.prepare(
          "UPDATE manga SET tags='[]' WHERE id=? AND manual_tags=0",
        ).run(mid);
      }
    })();
    const mangaTitle = (
      db.prepare("SELECT title FROM manga WHERE id=?").get(mid) as {
        title: string;
      }
    ).title;
    const mangaDoneBefore = done;
    const mangaReusedBefore = reused;
    const mangaSkippedBefore = skippedChapters;
    log.info("import.manga.started", "正在导入漫画", {
      jobId: id,
      mangaId: mid,
      title: mangaTitle,
      path: mangaPath,
      chapterCount: plan.chapters.length,
      imageCount: plan.chapters.reduce(
        (count, chapter) => count + (chapter.files?.length || 0),
        0,
      ),
    });
    let position = 0;
    for (const chapter of plan.chapters) {
      const chapterPath = relative(chapter.path);
      const cid =
        (
          db
            .prepare("SELECT id FROM chapters WHERE path=?")
            .get(chapterPath) as any
        )?.id || hash(chapterPath);
      if (chapter.files === null) {
        skippedChapters++;
        continue;
      }
      const stats = await mapConcurrent(chapter.files, 16, (file) =>
        fs.stat(file),
      );
      const signatures = chapter.files.map(
        (file, index) =>
          `${path.basename(file)}:${stats[index].size}:${stats[index].mtimeMs}`,
      );
      const fingerprint = hash(
        `${chapterProcessingVersion}:${signatures.join("|")}`,
      );
      const old = db
        .prepare("SELECT * FROM chapters WHERE id=?")
        .get(cid) as any;
      if (
        old?.fingerprint === fingerprint &&
        (await outputsExist(
          JSON.parse(old.pages).flatMap(
            (page: {
              optimized: string;
              original: string;
              thumbnail: string;
            }) => [page.optimized, page.original, page.thumbnail],
          ),
        ))
      ) {
        done += chapter.files.length;
        reused += chapter.files.length;
        progress(`已跳过未变化章节：${old.title}`, true);
        continue;
      }
      log.info("import.chapter.started", "正在处理章节", {
        jobId: id,
        mangaId: mid,
        mangaTitle,
        chapterId: cid,
        chapterTitle: path.basename(chapter.path),
        imageCount: chapter.files.length,
      });
      let completed = 0;
      const pages = await processChapter(
        cid,
        chapter.files,
        signatures,
        stats.map((stat) => stat.size),
        (cached) => {
          done++;
          completed++;
          if (cached) {
            reused++;
          }
          progress(
            `${path.basename(plan.mangaPath)} / ${path.basename(chapter.path)} · ${completed}/${chapter.files!.length}`,
          );
        },
      );
      db.transaction(() => {
        for (const page of pages) {
          for (const file of [page.original, page.optimized, page.thumbnail]) {
            db.prepare("INSERT OR REPLACE INTO media_assets VALUES(?,?)").run(
              file,
              mid,
            );
          }
        }
        db.prepare(
          `
        INSERT INTO chapters (
          id, manga_id, path, title, position, pages, fingerprint
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          position = excluded.position,
          pages = excluded.pages,
          fingerprint = excluded.fingerprint
        `,
        ).run(
          cid,
          mid,
          chapterPath,
          path.basename(chapter.path),
          position++,
          JSON.stringify(pages),
          fingerprint,
        );
        db.prepare("INSERT OR REPLACE INTO chapter_versions VALUES (?, ?)").run(
          cid,
          chapterProcessingVersion,
        );
        db.prepare("UPDATE chapters SET scanned_title=? WHERE id=?").run(
          path.basename(chapter.path),
          cid,
        );
      })();
    }
    const ordered = (
      db.prepare("SELECT id,path FROM chapters WHERE manga_id=?").all(mid) as {
        id: string;
        path: string;
      }[]
    ).sort((a, b) => compare(a.path, b.path));
    db.transaction(() => {
      for (const [index, chapter] of ordered.entries()) {
        db.prepare("UPDATE chapters SET position=? WHERE id=?").run(
          index,
          chapter.id,
        );
      }
    })();
    log.info("import.manga.completed", "漫画导入完成", {
      jobId: id,
      mangaId: mid,
      title: mangaTitle,
      processedImages: done - mangaDoneBefore - (reused - mangaReusedBefore),
      reusedImages: reused - mangaReusedBefore,
      skippedChapters: skippedChapters - mangaSkippedBefore,
    });
  }
  db.prepare("UPDATE sources SET last_scan=? WHERE id=?").run(
    new Date().toISOString(),
    source.id,
  );
  const message = `${mode === "new" ? "新增刷新" : "全部刷新"}完成，处理 ${total - reused} 张，复用 ${reused} 张，跳过 ${skippedChapters} 话`;
  db.prepare(
    "UPDATE jobs SET status='completed',done=total,message=? WHERE id=?",
  ).run(message, id);
  log.info("import.completed", "导入任务完成", {
    jobId: id,
    sourceId: source.id,
    mangaCount: plans.length,
    totalImages: total,
    processedImages: total - reused,
    reusedImages: reused,
    skippedChapters,
    durationMs: Date.now() - startedAt,
  });
}

// Upgrade existing records only: preserve retained grants, titles and source links.
export async function upgradeImages() {
  const chapters = db
    .prepare(
      `
    SELECT c.id, c.manga_id, c.path, c.title,
      (SELECT MIN(ms.source_id) FROM manga_sources ms
       WHERE ms.manga_id = c.manga_id) AS source_id
    FROM chapters c
    LEFT JOIN chapter_versions v ON v.chapter_id = c.id
    WHERE v.version IS NULL OR v.version <> ?
    ORDER BY source_id, c.manga_id, c.position
  `,
    )
    .all(chapterProcessingVersion) as {
    id: string;
    manga_id: string;
    path: string;
    title: string;
    source_id: string | null;
  }[];
  if (!chapters.length) {
    return;
  }
  busy = true;
  const groups = new Map<string | null, typeof chapters>();
  for (const chapter of chapters) {
    const group = groups.get(chapter.source_id) || [];
    group.push(chapter);
    groups.set(chapter.source_id, group);
  }
  const tasks = [...groups].map(([sourceId, items]) => {
    const id = crypto.randomUUID();
    db.prepare(
      `INSERT INTO jobs(id,source_id,status,message)
      VALUES(?,?,'running','图片版本升级：等待处理')`,
    ).run(id, sourceId);
    return { id, items };
  });
  try {
    for (const { id, items } of tasks) {
      try {
        log.info("images.upgrade.started", "图片版本升级开始", { jobId: id });
        const plans = await mapConcurrent(items, 8, async (chapter) => ({
          chapter,
          images: await files(await safeDirectory(chapter.path)),
        }));
        const total = plans.reduce((sum, plan) => sum + plan.images.length, 0);
        db.prepare("UPDATE jobs SET total=? WHERE id=?").run(total, id);
        let done = 0;
        let lastProgress = 0;
        for (const { chapter, images } of plans) {
          if (!images.length) {
            throw Error(`章节素材为空：${chapter.path}`);
          }
          log.info("images.upgrade.chapter.started", "正在升级章节图片", {
            jobId: id,
            chapterId: chapter.id,
            path: chapter.path,
          });
          const stats = await mapConcurrent(images, 16, (file) =>
            fs.stat(file),
          );
          const signatures = images.map(
            (file, i) =>
              `${path.basename(file)}:${stats[i].size}:${stats[i].mtimeMs}`,
          );
          const pages = await processChapter(
            chapter.id,
            images,
            signatures,
            stats.map((stat) => stat.size),
            () => {
              done++;
              if (Date.now() - lastProgress >= 100) {
                db.prepare("UPDATE jobs SET done=?,message=? WHERE id=?").run(
                  done,
                  `图片版本升级：${chapter.path}`,
                  id,
                );
                lastProgress = Date.now();
              }
            },
          );
          db.transaction(() => {
            for (const page of pages) {
              for (const file of [
                page.original,
                page.optimized,
                page.thumbnail,
              ]) {
                db.prepare(
                  "INSERT OR REPLACE INTO media_assets VALUES(?,?)",
                ).run(file, chapter.manga_id);
              }
            }
            db.prepare(
              "UPDATE chapters SET pages=?,fingerprint=? WHERE id=?",
            ).run(
              JSON.stringify(pages),
              hash(`${chapterProcessingVersion}:${signatures.join("|")}`),
              chapter.id,
            );
            db.prepare(
              "INSERT OR REPLACE INTO chapter_versions VALUES(?,?)",
            ).run(chapter.id, chapterProcessingVersion);
          })();
          log.info("images.upgrade.chapter.completed", "章节图片升级完成", {
            jobId: id,
            chapterId: chapter.id,
            pageCount: pages.length,
          });
        }
        db.prepare(
          `UPDATE jobs
           SET status='completed', done=total, message='图片版本升级完成'
           WHERE id=?`,
        ).run(id);
        log.info("images.upgrade.completed", "图片版本升级完成", { jobId: id });
      } catch (error) {
        const message = errorMessage(error);
        db.prepare("UPDATE jobs SET status='failed',error=? WHERE id=?").run(
          message,
          id,
        );
        log.error("images.upgrade.failed", "图片版本升级失败，下次启动重试", {
          jobId: id,
          error: message,
        });
      }
    }
  } finally {
    busy = false;
  }
}
