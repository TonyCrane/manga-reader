import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { log } from "./log";

export const dataDir = path.resolve(process.env.DATA_DIR || ".data");

export const processedDir = path.resolve(
  process.env.PROCESSED_DIR || ".processed",
);

export const mangaDir = path.resolve(process.env.MANGA_DIR || "/manga");

// Resolve existing ancestors too, so symlinked mount paths cannot overlap.
function canonical(directory: string): string {
  if (fs.existsSync(directory)) {
    return fs.realpathSync(directory);
  }
  return path.join(
    canonical(path.dirname(directory)),
    path.basename(directory),
  );
}

const roots = [mangaDir, dataDir, processedDir].map(canonical);

for (let i = 0; i < roots.length; i++) {
  for (let j = i + 1; j < roots.length; j++) {
    if (
      roots[i] === roots[j] ||
      roots[i].startsWith(
        roots[j].endsWith(path.sep) ? roots[j] : roots[j] + path.sep,
      ) ||
      roots[j].startsWith(
        roots[i].endsWith(path.sep) ? roots[i] : roots[i] + path.sep,
      )
    ) {
      throw new Error("素材、数据库和处理图片目录必须互不重叠");
    }
  }
}

for (const dir of [dataDir, processedDir]) {
  fs.mkdirSync(dir, { recursive: true });
}

export const db = new Database(path.join(dataDir, "library.sqlite"));

db.pragma("journal_mode = WAL");

db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS sources (
    id TEXT PRIMARY KEY,
    path TEXT UNIQUE NOT NULL,
    mode TEXT NOT NULL,
    last_scan TEXT
  );

  CREATE TABLE IF NOT EXISTS manga (
    id TEXT PRIMARY KEY,
    path TEXT UNIQUE NOT NULL,
    title TEXT NOT NULL,
    scanned_title TEXT,
    title_override TEXT,
    author TEXT DEFAULT '',
    published TEXT DEFAULT '',
    tags TEXT DEFAULT '[]',
    manual_tags INTEGER DEFAULT 0,
    cover TEXT,
    created TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS chapters (
    id TEXT PRIMARY KEY,
    manga_id TEXT REFERENCES manga(id) ON DELETE CASCADE,
    path TEXT UNIQUE NOT NULL,
    title TEXT NOT NULL,
    scanned_title TEXT,
    title_override TEXT,
    position INTEGER NOT NULL,
    pages TEXT NOT NULL,
    fingerprint TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    source_id TEXT,
    status TEXT,
    done INTEGER DEFAULT 0,
    total INTEGER DEFAULT 0,
    message TEXT,
    error TEXT,
    created TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    is_admin INTEGER NOT NULL DEFAULT 0,
    must_change_password INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    expires INTEGER NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS user_preferences (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    library_sort TEXT NOT NULL DEFAULT 'title'
      CHECK (library_sort IN ('title', 'author', 'count', 'created', 'published')),
    library_ascending INTEGER NOT NULL DEFAULT 1
      CHECK (library_ascending IN (0, 1))
  );

  CREATE TABLE IF NOT EXISTS source_users (
    source_id TEXT REFERENCES sources(id) ON DELETE CASCADE,
    user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (source_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS manga_sources (
    manga_id TEXT REFERENCES manga(id) ON DELETE CASCADE,
    source_id TEXT REFERENCES sources(id) ON DELETE CASCADE,
    PRIMARY KEY (manga_id, source_id)
  );

  CREATE TABLE IF NOT EXISTS manga_users (
    manga_id TEXT REFERENCES manga(id) ON DELETE CASCADE,
    user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (manga_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS media_assets (
    file TEXT PRIMARY KEY,
    manga_id TEXT REFERENCES manga(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS media_manga ON media_assets(manga_id);
`);

const interruptedJobs = db
  .prepare(
    `
  UPDATE jobs
  SET
    status = 'failed',
    error = '服务重启中断了导入，请重新刷新'
  WHERE status IN ('running', 'queued')
  `,
  )
  .run();
if (interruptedJobs.changes) {
  log.warn("jobs.interrupted", "未完成的导入任务已标记为失败", {
    jobCount: interruptedJobs.changes,
  });
}

export function mangaList() {
  return db
    .prepare(
      `
      SELECT
        m.*,
        (
          SELECT COUNT(*)
          FROM chapters c
          WHERE c.manga_id = m.id
        ) AS chapterCount
      FROM manga m
      ORDER BY m.title COLLATE BINARY
      `,
    )
    .all()
    .map((m: any) => ({ ...m, tags: JSON.parse(m.tags) }));
}

export function detail(id: string) {
  const m = mangaList().find((m: any) => m.id === id);
  if (!m) {
    return null;
  }
  return {
    ...m,
    chapters: db
      .prepare("SELECT * FROM chapters WHERE manga_id=? ORDER BY position")
      .all(id)
      .map((c: any) => ({ ...c, pages: JSON.parse(c.pages) })),
  };
}
