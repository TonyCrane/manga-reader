import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { mapConcurrent } from "./concurrency";
import { hash, outputsExist, processChapter } from "./images";
import { db, mangaDir } from "./db";

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
  tag?: string;
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
  void run(source, id, mode)
    .catch((e) =>
      db
        .prepare("UPDATE jobs SET status='failed',error=? WHERE id=?")
        .run(String(e.message), id),
    )
    .finally(() => {
      busy = false;
    });
  return id;
}

async function run(source: Source, id: string, mode: RefreshMode) {
  const root = await safeDirectory(source.path);
  let candidates: { p: string; tag?: string }[] = [];
  if (source.mode === "manual") {
    candidates = [{ p: root }];
  } else if (source.mode === "one") {
    candidates = (await dirs(root)).map((p) => ({ p }));
  } else {
    const groups = await mapConcurrent(await dirs(root), 8, async (tag) =>
      (await dirs(tag)).map((p) => ({ p, tag: path.basename(tag) })),
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
  const scanned = await mapConcurrent(candidates, 8, async ({ p, tag }) => {
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
    return { mangaPath: p, tag, chapters };
  });
  const plans = scanned.filter((plan) => plan.chapters.length);
  const total = plans.reduce(
    (n, p) => n + p.chapters.reduce((n, c) => n + (c.files?.length || 0), 0),
    0,
  );
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
    const mid =
      (db.prepare("SELECT id FROM manga WHERE path=?").get(mangaPath) as any)
        ?.id || hash(mangaPath);
    db.transaction(() => {
      db.prepare(
        "INSERT OR IGNORE INTO manga(id,path,title,tags) VALUES(?,?,?,?)",
      ).run(
        mid,
        mangaPath,
        path.basename(plan.mangaPath),
        JSON.stringify(plan.tag ? [plan.tag] : []),
      );
      db.prepare("INSERT OR IGNORE INTO manga_sources VALUES(?,?)").run(
        mid,
        source.id,
      );
      db.prepare("DELETE FROM manga_users WHERE manga_id = ?").run(mid);
      db.prepare("UPDATE manga SET scanned_title=? WHERE id=?").run(
        path.basename(plan.mangaPath),
        mid,
      );
      if (plan.tag) {
        const row = db
          .prepare("SELECT tags,manual_tags FROM manga WHERE id=?")
          .get(mid) as any;
        if (!row.manual_tags) {
          db.prepare("UPDATE manga SET tags=? WHERE id=?").run(
            JSON.stringify([...new Set([...JSON.parse(row.tags), plan.tag])]),
            mid,
          );
        }
      }
    })();
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
      const fingerprint = hash("v2:" + signatures.join("|"));
      const old = db
        .prepare("SELECT * FROM chapters WHERE id=?")
        .get(cid) as any;
      if (
        old?.fingerprint === fingerprint &&
        (await outputsExist(
          JSON.parse(old.pages).flatMap(
            (page: { optimized: string; original: string }) => [
              page.optimized,
              page.original,
            ],
          ),
        ))
      ) {
        done += chapter.files.length;
        reused += chapter.files.length;
        progress(`已跳过未变化章节：${old.title}`, true);
        continue;
      }
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
          for (const file of [page.original, page.optimized]) {
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
  }
  db.prepare("UPDATE sources SET last_scan=? WHERE id=?").run(
    new Date().toISOString(),
    source.id,
  );
  db.prepare(
    "UPDATE jobs SET status='completed',done=total,message=? WHERE id=?",
  ).run(
    `${mode === "new" ? "新增刷新" : "全部刷新"}完成，处理 ${total - reused} 张，复用 ${reused} 张，跳过 ${skippedChapters} 话`,
    id,
  );
}
