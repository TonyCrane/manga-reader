import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { mapConcurrent } from "../shared/concurrency";
import {
  chapterFingerprint,
  chapterProcessingKey,
  chapterProcessingVersion,
  hash,
  outputsExist,
  processChapter,
} from "./images";
import { errorMessage, log } from "../shared/log";
import { db, mangaDir } from "./database";
import { isStorageMaintenanceBusy } from "./storage";

const binaryCompare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

// Numeric collation also handles names such as 2_page.jpg and page10.jpg.
const naturalOrder = new Intl.Collator("en", { numeric: true });
const compareNames = (a: string, b: string) =>
  naturalOrder.compare(path.basename(a), path.basename(b)) ||
  binaryCompare(a, b);

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
    .sort(compareNames);
}

async function files(p: string) {
  const entries = await fs.readdir(p, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && extensions.test(e.name))
    .map((e) => path.join(p, e.name))
    .sort(compareNames);
}

async function sourceImageStats(root: string) {
  const directories = [root];
  let cursor = 0;
  let imageCount = 0;
  let imageBytes = 0;
  while (cursor < directories.length) {
    const batch = directories.slice(cursor, cursor + 32);
    cursor += batch.length;
    const listings = await mapConcurrent(batch, 16, async (directory) => ({
      directory,
      entries: await fs.readdir(directory, { withFileTypes: true }),
    }));
    const images: string[] = [];
    for (const listing of listings) {
      for (const entry of listing.entries) {
        const file = path.join(listing.directory, entry.name);
        if (entry.isDirectory() && !entry.name.startsWith(".")) {
          directories.push(file);
        } else if (entry.isFile() && extensions.test(entry.name)) {
          images.push(file);
        }
      }
    }
    const sizes = await mapConcurrent(images, 32, (file) => fs.stat(file));
    imageCount += sizes.length;
    imageBytes += sizes.reduce((sum, stat) => sum + stat.size, 0);
  }
  return { imageCount, imageBytes };
}

async function updateSourceStats(source: Source) {
  const stats = await sourceImageStats(await safeDirectory(source.path));
  db.prepare(
    `
    UPDATE sources
    SET image_count=?,image_bytes=?,stats_updated=?
    WHERE id=?
    `,
  ).run(
    stats.imageCount,
    stats.imageBytes,
    new Date().toISOString(),
    source.id,
  );
  return stats;
}

export async function upgradeSourceStats() {
  const sources = db
    .prepare(
      "SELECT id,path,mode FROM sources WHERE stats_updated IS NULL ORDER BY rowid",
    )
    .all() as Source[];
  for (const source of sources) {
    try {
      const stats = await updateSourceStats(source);
      log.info("source.stats.updated", "导入源空间统计已更新", {
        sourceId: source.id,
        imageCount: stats.imageCount,
        imageBytes: stats.imageBytes,
      });
    } catch (error) {
      log.warn("source.stats.failed", "导入源空间统计失败", {
        sourceId: source.id,
        error: errorMessage(error),
      });
    }
  }
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

type StoredPage = {
  original: string | null;
  optimized: string;
  thumbnail: string;
  part: string;
};

const pageAssets = (page: StoredPage) =>
  [page.original, page.optimized, page.thumbnail].filter(
    (file): file is string => Boolean(file),
  );

export type RefreshMode = "all" | "new";

type Plan = {
  mangaPath: string;
  author?: string;
  chapters: { path: string; files: string[] | null }[];
};

let busy = false;

export const isImporterBusy = () => busy;

export function startImport(source: Source, mode: RefreshMode = "all") {
  if (busy || isStorageMaintenanceBusy()) {
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
  const refreshedAt = new Date(startedAt).toISOString();
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
        INSERT OR IGNORE INTO manga(id,path,title,author,tags,updated)
        VALUES(?,?,?,?,?,?)
        `,
      ).run(mid, mangaPath, scannedTitle, plan.author || "", "[]", refreshedAt);
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
    const mangaTitle = db
      .prepare("SELECT title,split_pages FROM manga WHERE id=?")
      .get(mid) as {
      title: string;
      split_pages: number;
    };
    const splitPages = Boolean(mangaTitle.split_pages);
    const mangaDoneBefore = done;
    const mangaReusedBefore = reused;
    const mangaSkippedBefore = skippedChapters;
    log.info("import.manga.started", "正在导入漫画", {
      jobId: id,
      mangaId: mid,
      title: mangaTitle.title,
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
      const fingerprint = chapterFingerprint(signatures, splitPages);
      const old = db
        .prepare("SELECT * FROM chapters WHERE id=?")
        .get(cid) as any;
      if (
        old?.fingerprint === fingerprint &&
        (await outputsExist(
          JSON.parse(old.pages).flatMap((page: StoredPage) => pageAssets(page)),
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
        mangaTitle: mangaTitle.title,
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
        splitPages,
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
          for (const file of pageAssets(page)) {
            db.prepare("INSERT OR REPLACE INTO media_assets VALUES(?,?)").run(
              file,
              mid,
            );
          }
        }
        db.prepare(
          `
        INSERT INTO chapters (
          id, manga_id, path, title, position, pages, page_count, fingerprint
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          position = excluded.position,
          pages = excluded.pages,
          page_count = excluded.page_count,
          fingerprint = excluded.fingerprint
        `,
        ).run(
          cid,
          mid,
          chapterPath,
          path.basename(chapter.path),
          position++,
          JSON.stringify(pages),
          pages.length,
          fingerprint,
        );
        db.prepare("INSERT OR REPLACE INTO chapter_versions VALUES (?, ?)").run(
          cid,
          chapterProcessingKey(splitPages),
        );
        db.prepare("UPDATE chapters SET scanned_title=? WHERE id=?").run(
          path.basename(chapter.path),
          cid,
        );
        if (!old) {
          db.prepare("UPDATE manga SET updated=? WHERE id=?").run(
            refreshedAt,
            mid,
          );
        }
      })();
    }
    const ordered = (
      db.prepare("SELECT id,path FROM chapters WHERE manga_id=?").all(mid) as {
        id: string;
        path: string;
      }[]
    ).sort((a, b) => compareNames(a.path, b.path));
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
      title: mangaTitle.title,
      processedImages: done - mangaDoneBefore - (reused - mangaReusedBefore),
      reusedImages: reused - mangaReusedBefore,
      skippedChapters: skippedChapters - mangaSkippedBefore,
    });
  }
  const sourceStats = await updateSourceStats(source);
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
    sourceImageCount: sourceStats.imageCount,
    sourceImageBytes: sourceStats.imageBytes,
    durationMs: Date.now() - startedAt,
  });
}

type MangaChapter = {
  id: string;
  manga_id: string;
  path: string;
  title: string;
};

export function startMangaReprocess(mangaId: string, splitPages: boolean) {
  if (busy || isStorageMaintenanceBusy()) {
    throw Error("已有图片处理任务正在进行，请稍后再试");
  }
  const manga = db
    .prepare("SELECT title FROM manga WHERE id=?")
    .get(mangaId) as { title: string } | undefined;
  if (!manga) {
    throw Error("漫画不存在");
  }
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO jobs(id,status,message)
     VALUES(?, 'running', ?)`,
  ).run(id, `正在重新扫描：${manga.title}`);
  busy = true;
  log.info("manga.reprocess.started", "漫画图片重新处理已启动", {
    jobId: id,
    mangaId,
    title: manga.title,
    splitPages,
  });
  void reprocessManga(mangaId, manga.title, splitPages, id)
    .catch((error) => {
      const message = errorMessage(error);
      db.prepare("UPDATE jobs SET status='failed',error=? WHERE id=?").run(
        message,
        id,
      );
      log.error("manga.reprocess.failed", "漫画图片重新处理失败", {
        jobId: id,
        mangaId,
        title: manga.title,
        splitPages,
        error: message,
      });
    })
    .finally(() => {
      busy = false;
    });
  return id;
}

async function reprocessManga(
  mangaId: string,
  mangaTitle: string,
  splitPages: boolean,
  jobId: string,
) {
  const chapters = db
    .prepare(
      `SELECT id,manga_id,path,title
       FROM chapters
       WHERE manga_id=?
       ORDER BY position`,
    )
    .all(mangaId) as MangaChapter[];
  const plans = await mapConcurrent(chapters, 8, async (chapter) => ({
    chapter,
    images: await files(await safeDirectory(chapter.path)),
  }));
  const total = plans.reduce((sum, plan) => sum + plan.images.length, 0);
  db.prepare("UPDATE jobs SET total=? WHERE id=?").run(total, jobId);
  let done = 0;
  let lastProgress = 0;
  for (const { chapter, images } of plans) {
    if (!images.length) {
      throw Error(`章节素材为空：${chapter.path}`);
    }
    const stats = await mapConcurrent(images, 16, (file) => fs.stat(file));
    const signatures = images.map(
      (file, index) =>
        `${path.basename(file)}:${stats[index].size}:${stats[index].mtimeMs}`,
    );
    const pages = await processChapter(
      chapter.id,
      images,
      signatures,
      stats.map((stat) => stat.size),
      splitPages,
      () => {
        done++;
        if (Date.now() - lastProgress >= 100) {
          db.prepare("UPDATE jobs SET done=?,message=? WHERE id=?").run(
            done,
            `正在重新处理：${mangaTitle} / ${chapter.title}`,
            jobId,
          );
          lastProgress = Date.now();
        }
      },
    );
    db.transaction(() => {
      for (const page of pages) {
        for (const file of pageAssets(page)) {
          db.prepare("INSERT OR REPLACE INTO media_assets VALUES(?,?)").run(
            file,
            mangaId,
          );
        }
      }
      db.prepare(
        "UPDATE chapters SET pages=?,page_count=?,fingerprint=? WHERE id=?",
      ).run(
        JSON.stringify(pages),
        pages.length,
        chapterFingerprint(signatures, splitPages),
        chapter.id,
      );
      db.prepare("INSERT OR REPLACE INTO chapter_versions VALUES(?,?)").run(
        chapter.id,
        chapterProcessingKey(splitPages),
      );
    })();
  }
  db.prepare(
    `UPDATE jobs
     SET status='completed',done=total,message='漫画图片重新处理完成'
     WHERE id=?`,
  ).run(jobId);
  log.info("manga.reprocess.completed", "漫画图片重新处理完成", {
    jobId,
    mangaId,
    title: mangaTitle,
    splitPages,
    imageCount: total,
  });
}

// Upgrade existing records only: preserve retained grants, titles and source links.
export async function upgradeImages() {
  const chapters = db
    .prepare(
      `
    SELECT c.id, c.manga_id, c.path, c.title, c.pages, c.fingerprint,
      m.split_pages, v.version AS processing_version,
      (SELECT MIN(ms.source_id) FROM manga_sources ms
       WHERE ms.manga_id = c.manga_id) AS source_id
    FROM chapters c
    JOIN manga m ON m.id = c.manga_id
    LEFT JOIN chapter_versions v ON v.chapter_id = c.id
    WHERE
      v.version IS NULL
      OR v.version <> CASE WHEN m.split_pages = 1 THEN ? ELSE ? END
    ORDER BY source_id, c.manga_id, c.position
  `,
    )
    .all(chapterProcessingVersion, chapterProcessingKey(false)) as {
    id: string;
    manga_id: string;
    path: string;
    title: string;
    pages: string;
    fingerprint: string;
    split_pages: number;
    processing_version: string | null;
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
          const splitPages = Boolean(chapter.split_pages);
          const legacyKey = splitPages ? "v5" : "v5:whole";
          const legacyFingerprint = hash(
            `${legacyKey}:${signatures.join("|")}`,
          );
          if (
            chapter.processing_version === legacyKey &&
            chapter.fingerprint === legacyFingerprint
          ) {
            const migratedPages = (
              JSON.parse(chapter.pages) as StoredPage[]
            ).map((page) => ({
              ...page,
              original: page.part === "single" ? null : page.original,
            }));
            if (
              migratedPages.every(
                (page) =>
                  page.optimized &&
                  page.thumbnail &&
                  (page.part === "single" || page.original),
              ) &&
              (await outputsExist(migratedPages.flatMap(pageAssets)))
            ) {
              db.transaction(() => {
                db.prepare(
                  "UPDATE chapters SET pages=?,fingerprint=? WHERE id=?",
                ).run(
                  JSON.stringify(migratedPages),
                  chapterFingerprint(signatures, splitPages),
                  chapter.id,
                );
                db.prepare(
                  "INSERT OR REPLACE INTO chapter_versions VALUES(?,?)",
                ).run(chapter.id, chapterProcessingKey(splitPages));
              })();
              done += images.length;
              db.prepare("UPDATE jobs SET done=?,message=? WHERE id=?").run(
                done,
                `图片版本升级：${chapter.path}`,
                id,
              );
              log.info(
                "images.upgrade.chapter.migrated",
                "章节图片记录已升级并复用现有文件",
                {
                  jobId: id,
                  chapterId: chapter.id,
                  pageCount: migratedPages.length,
                },
              );
              continue;
            }
          }
          const pages = await processChapter(
            chapter.id,
            images,
            signatures,
            stats.map((stat) => stat.size),
            splitPages,
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
              for (const file of pageAssets(page)) {
                db.prepare(
                  "INSERT OR REPLACE INTO media_assets VALUES(?,?)",
                ).run(file, chapter.manga_id);
              }
            }
            db.prepare(
              "UPDATE chapters SET pages=?,page_count=?,fingerprint=? WHERE id=?",
            ).run(
              JSON.stringify(pages),
              pages.length,
              chapterFingerprint(signatures, splitPages),
              chapter.id,
            );
            db.prepare(
              "INSERT OR REPLACE INTO chapter_versions VALUES(?,?)",
            ).run(chapter.id, chapterProcessingKey(splitPages));
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
