import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { log } from "../shared/log";

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
    last_scan TEXT,
    image_count INTEGER NOT NULL DEFAULT 0 CHECK (image_count >= 0),
    image_bytes INTEGER NOT NULL DEFAULT 0 CHECK (image_bytes >= 0),
    stats_updated TEXT
  );

  CREATE TABLE IF NOT EXISTS manga (
    id TEXT PRIMARY KEY,
    path TEXT UNIQUE NOT NULL,
    title TEXT NOT NULL,
    title_zh TEXT NOT NULL DEFAULT '',
    scanned_title TEXT,
    title_override TEXT,
    author TEXT DEFAULT '',
    published TEXT DEFAULT '',
    tags TEXT DEFAULT '[]',
    manual_tags INTEGER DEFAULT 0,
    split_pages INTEGER NOT NULL DEFAULT 1,
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
    page_count INTEGER NOT NULL DEFAULT 0 CHECK (page_count >= 0),
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

  CREATE TABLE IF NOT EXISTS translation_settings (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    api_key TEXT NOT NULL,
    model TEXT NOT NULL,
    prompt TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS system_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    expires INTEGER NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS user_preferences (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    library_sort TEXT NOT NULL DEFAULT 'title'
      CHECK (
        library_sort IN (
          'title', 'author', 'count', 'pages', 'created', 'published'
        )
      ),
    library_ascending INTEGER NOT NULL DEFAULT 1
      CHECK (library_ascending IN (0, 1)),
    title_language TEXT NOT NULL DEFAULT 'ja'
      CHECK (title_language IN ('ja', 'zh'))
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

  CREATE INDEX IF NOT EXISTS chapters_manga_position
    ON chapters(manga_id, position);
  CREATE INDEX IF NOT EXISTS manga_sources_source
    ON manga_sources(source_id, manga_id);
  CREATE INDEX IF NOT EXISTS media_manga ON media_assets(manga_id);
  CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS chapter_versions (
    chapter_id TEXT PRIMARY KEY REFERENCES chapters(id) ON DELETE CASCADE,
    version TEXT NOT NULL
  );
`);

const preferenceColumns = db
  .prepare("PRAGMA table_info(user_preferences)")
  .all() as { name: string }[];
if (!preferenceColumns.some((column) => column.name === "title_language")) {
  db.exec(`
    ALTER TABLE user_preferences
    ADD COLUMN title_language TEXT NOT NULL DEFAULT 'ja'
      CHECK (title_language IN ('ja', 'zh'))
  `);
}

const preferenceTable = db
  .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?")
  .get("user_preferences") as { sql: string };
if (!preferenceTable.sql.includes("'pages'")) {
  db.transaction(() => {
    db.exec(`
      CREATE TABLE user_preferences_next (
        user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        library_sort TEXT NOT NULL DEFAULT 'title'
          CHECK (
            library_sort IN (
              'title', 'author', 'count', 'pages', 'created', 'published'
            )
          ),
        library_ascending INTEGER NOT NULL DEFAULT 1
          CHECK (library_ascending IN (0, 1)),
        title_language TEXT NOT NULL DEFAULT 'ja'
          CHECK (title_language IN ('ja', 'zh'))
      );

      INSERT INTO user_preferences_next (
        user_id, library_sort, library_ascending, title_language
      )
      SELECT user_id, library_sort, library_ascending, title_language
      FROM user_preferences;

      DROP TABLE user_preferences;
      ALTER TABLE user_preferences_next RENAME TO user_preferences;
    `);
  })();
}

const mangaColumns = new Set(
  (db.prepare("PRAGMA table_info(manga)").all() as { name: string }[]).map(
    (column) => column.name,
  ),
);

const sourceColumns = new Set(
  (db.prepare("PRAGMA table_info(sources)").all() as { name: string }[]).map(
    (column) => column.name,
  ),
);
if (!sourceColumns.has("image_count")) {
  db.exec(
    "ALTER TABLE sources ADD COLUMN image_count INTEGER NOT NULL DEFAULT 0 CHECK (image_count >= 0)",
  );
}
if (!sourceColumns.has("image_bytes")) {
  db.exec(
    "ALTER TABLE sources ADD COLUMN image_bytes INTEGER NOT NULL DEFAULT 0 CHECK (image_bytes >= 0)",
  );
}
if (!sourceColumns.has("stats_updated")) {
  db.exec("ALTER TABLE sources ADD COLUMN stats_updated TEXT");
}

if (!mangaColumns.has("title_zh")) {
  db.exec("ALTER TABLE manga ADD COLUMN title_zh TEXT NOT NULL DEFAULT ''");
}
if (!mangaColumns.has("split_pages")) {
  db.exec(
    "ALTER TABLE manga ADD COLUMN split_pages INTEGER NOT NULL DEFAULT 1",
  );
}

const chapterColumns = new Set(
  (db.prepare("PRAGMA table_info(chapters)").all() as { name: string }[]).map(
    (column) => column.name,
  ),
);
if (!chapterColumns.has("page_count")) {
  db.transaction(() => {
    db.exec(
      "ALTER TABLE chapters ADD COLUMN page_count INTEGER NOT NULL DEFAULT 0",
    );
    db.exec("UPDATE chapters SET page_count = json_array_length(pages)");
  })();
}

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

const mangaSummary = `
  SELECT
    m.*,
    COUNT(c.id) AS chapterCount,
    COALESCE(SUM(c.page_count), 0) AS pageCount
  FROM manga m
  LEFT JOIN chapters c ON c.manga_id = m.id
`;

type MangaRow = {
  id: string;
  path: string;
  title: string;
  title_zh: string;
  scanned_title: string | null;
  title_override: string | null;
  author: string;
  published: string;
  tags: string;
  manual_tags: number;
  split_pages: number;
  cover: string | null;
  created: string;
  chapterCount: number;
  pageCount: number;
};

function parseManga(manga: MangaRow) {
  return { ...manga, tags: JSON.parse(manga.tags) as string[] };
}

const mangaListStatement = db.prepare(`
  ${mangaSummary}
  WHERE
    EXISTS (
      SELECT 1
      FROM manga_sources ms
      JOIN source_users su ON su.source_id = ms.source_id
      WHERE ms.manga_id = m.id AND su.user_id = ?
    )
    OR EXISTS (
      SELECT 1
      FROM manga_users mu
      WHERE mu.manga_id = m.id AND mu.user_id = ?
    )
  GROUP BY m.id
  ORDER BY m.title COLLATE BINARY
`);

const mangaDetailStatement = db.prepare(`
  ${mangaSummary}
  WHERE m.id = ?
  GROUP BY m.id
`);

const mangaChaptersStatement = db.prepare(`
  SELECT
    id,
    manga_id,
    path,
    title,
    scanned_title,
    title_override,
    position,
    pages,
    fingerprint
  FROM chapters
  WHERE manga_id = ?
  ORDER BY position
`);

const coverSourceStatement = db.prepare(`
  SELECT
    m.id,
    COALESCE(
      NULLIF(m.cover, ''),
      (
        SELECT json_extract(c.pages, '$[0].optimized')
        FROM chapters c
        WHERE c.manga_id = m.id
        ORDER BY c.position
        LIMIT 1
      )
    ) AS source
  FROM manga m
  WHERE m.id = ?
`);

export function mangaList(userId: string) {
  return mangaListStatement
    .all(userId, userId)
    .map((manga) => parseManga(manga as MangaRow));
}

export function detail(id: string) {
  const row = mangaDetailStatement.get(id) as MangaRow | undefined;
  const m = row ? parseManga(row) : null;
  if (!m) {
    return null;
  }
  return {
    ...m,
    chapters: mangaChaptersStatement
      .all(id)
      .map((c: any) => ({ ...c, pages: JSON.parse(c.pages) })),
  };
}

export function coverSource(id: string) {
  return coverSourceStatement.get(id) as
    { id: string; source: string | null } | undefined;
}
