import express from "express";
import cookieParser from "cookie-parser";
import multer from "multer";
import crypto from "node:crypto";
import path from "node:path";
import fs from "node:fs";
import sharp from "sharp";
import { z } from "zod";
import { dataDir, db, mangaDir, processedDir, detail, mangaList } from "./db";
import {
  publicAuth,
  authenticate,
  accountRoutes,
  requirePasswordChanged,
} from "./auth";
import { userRoutes } from "./users";
import { canRead, requireAdmin, sourceList, setSourceUsers } from "./access";
import {
  browse,
  isImporterBusy,
  safeDirectory,
  startMangaReprocess,
  startImport,
  relativePath,
  upgradeImages,
} from "./importer";
import { errorMessage, log } from "./log";

import { translationRoutes } from "./translation";
import { versionInfo } from "./version";

const app = express();
const mangaIdSchema = z.string().regex(/^[a-f0-9]{24}$/, "无效的漫画 ID");

type MangaForDeletion = {
  id: string;
  title: string;
  path: string;
  cover: string | null;
  chapterIds: string[];
};

function mangaForDeletion(id: string): MangaForDeletion | null {
  const manga = db
    .prepare("SELECT id,title,path,cover FROM manga WHERE id=?")
    .get(id) as
    | { id: string; title: string; path: string; cover: string | null }
    | undefined;
  if (!manga) {
    return null;
  }
  return {
    ...manga,
    chapterIds: (
      db.prepare("SELECT id FROM chapters WHERE manga_id=?").all(id) as {
        id: string;
      }[]
    ).map((chapter) => chapter.id),
  };
}

function removeMangaFiles(manga: MangaForDeletion) {
  for (const chapterId of manga.chapterIds) {
    if (!mangaIdSchema.safeParse(chapterId).success) {
      throw Error("无效的章节 ID");
    }
    fs.rmSync(path.join(processedDir, chapterId), {
      recursive: true,
      force: true,
    });
  }
  if (!mangaIdSchema.safeParse(manga.id).success) {
    throw Error("无效的漫画 ID");
  }
  fs.rmSync(path.join(processedDir, "covers", manga.id), {
    recursive: true,
    force: true,
  });
  if (manga.cover && /^cover-[a-f0-9-]+\.webp$/.test(manga.cover)) {
    fs.rmSync(path.join(processedDir, manga.cover), { force: true });
  }
}

function coverFile(manga: NonNullable<ReturnType<typeof detail>>) {
  return manga.cover || manga.chapters[0]?.pages[0]?.optimized;
}

async function smallCover(mangaId: string, source: string) {
  const signature = crypto
    .createHash("sha256")
    .update(`v1:480x640:${source}`)
    .digest("hex")
    .slice(0, 24);
  const directory = path.join("covers", mangaId);
  const name = path.join(directory, `thumbnail-${signature}.webp`);
  const output = path.join(processedDir, name);
  if (!fs.existsSync(output) || fs.statSync(output).size === 0) {
    fs.mkdirSync(path.join(processedDir, directory), { recursive: true });
    const pending = path.join(
      processedDir,
      directory,
      `pending-${crypto.randomUUID()}.webp`,
    );
    try {
      await sharp(path.join(processedDir, source))
        .resize({
          width: 480,
          height: 640,
          fit: "cover",
          withoutEnlargement: true,
        })
        .webp({ quality: 82, effort: 4 })
        .toFile(pending);
      fs.renameSync(pending, output);
    } catch (error) {
      fs.rmSync(pending, { force: true });
      throw error;
    }
  }
  return name;
}

app.disable("x-powered-by");

app.use(express.json({ limit: "128kb" }), cookieParser());

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("X-Frame-Options", "DENY");
  if (
    !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
    req.headers.origin &&
    new URL(req.headers.origin).host !== req.headers.host
  ) {
    return res.status(403).json({ error: "不允许跨站请求" });
  }
  next();
});

app.get("/api/health", (_req, res) => res.json({ ok: true }));
app.use("/api", publicAuth);
app.use(["/api", "/media"], authenticate);
app.use("/api", accountRoutes);
app.use(["/api", "/media"], requirePasswordChanged);
app.use("/api/account/translation", requireAdmin, translationRoutes);
app.get("/api/version", (_req, res) => res.json(versionInfo));
app.use("/api/users", userRoutes);
app.use(["/api/sources", "/api/jobs", "/api/directories"], requireAdmin);
app.use("/api/manga/:id", (req, res, next) => {
  if (!canRead(res.locals.user.id, String(req.params.id))) {
    res.status(404).json({ error: "漫画不存在或无权访问" });
    return;
  }
  if (!["GET", "HEAD"].includes(req.method)) {
    requireAdmin(req, res, next);
    return;
  }
  next();
});
app.use("/api/chapters/:id", requireAdmin, (req, res, next) => {
  const chapter = db
    .prepare("SELECT manga_id FROM chapters WHERE id=?")
    .get(req.params.id) as { manga_id: string } | undefined;
  if (!chapter || !canRead(res.locals.user.id, chapter.manga_id)) {
    res.status(404).json({ error: "章节不存在或无权访问" });
    return;
  }
  next();
});

app.get("/api/manga", (_req, res) =>
  res.json(mangaList().filter((m) => canRead(res.locals.user.id, m.id))),
);

app.delete("/api/manga", requireAdmin, (req, res) => {
  if (db.prepare("SELECT 1 FROM jobs WHERE status='running'").get()) {
    return res.status(409).json({ error: "请等待导入完成后再删除漫画" });
  }
  const input = z
    .object({
      ids: z
        .array(mangaIdSchema)
        .min(1, "请至少选择一部漫画")
        .max(500, "一次最多删除 500 部漫画"),
    })
    .parse(req.body);
  const ids = [...new Set(input.ids)];
  const manga: MangaForDeletion[] = [];
  for (const id of ids) {
    const item = mangaForDeletion(id);
    if (!item || !canRead(res.locals.user.id, id)) {
      return res.status(404).json({ error: "漫画不存在或无权访问" });
    }
    manga.push(item);
  }
  for (const item of manga) {
    log.info("manga.delete.started", "正在删除漫画", {
      mangaId: item.id,
      title: item.title,
      path: item.path,
      reason: "batch",
    });
    removeMangaFiles(item);
  }
  const remove = db.prepare("DELETE FROM manga WHERE id=?");
  db.transaction(() => {
    for (const id of ids) {
      remove.run(id);
    }
  })();
  log.info("manga.delete.completed", "批量删除漫画完成", {
    reason: "batch",
    mangaCount: ids.length,
  });
  res.json({ ok: true, deleted: ids.length });
});

app.get("/api/manga/:id", (req, res) => {
  const m = detail(String(req.params.id));
  if (!m) {
    return res.status(404).json({ error: "漫画不存在" });
  }
  res.json(m);
});

const metadata = z.object({
  title: z.string().trim().max(200).nullable().optional(),
  titleZh: z.string().trim().max(200).optional(),
  author: z.string().trim().max(200).optional(),
  published: z.string().max(100).optional(),
  created: z.string().datetime({ offset: true }).optional(),
  tags: z.array(z.string().trim().min(1).max(80)).max(50).optional(),
  splitPages: z.boolean().optional(),
});

app.patch("/api/manga/:id", (req, res) => {
  const input = metadata.parse(req.body);
  const old = detail(String(req.params.id));
  if (!old) {
    return res.status(404).json({ error: "漫画不存在" });
  }
  const splitPages = input.splitPages ?? Boolean(old.split_pages);
  const splitPagesChanged = splitPages !== Boolean(old.split_pages);
  if (splitPagesChanged && isImporterBusy()) {
    return res
      .status(409)
      .json({ error: "请等待当前图片处理任务完成后再修改拆页设置" });
  }
  const override =
    input.title === undefined ? old.title_override : input.title || null;
  db.prepare(
    `
    UPDATE manga
    SET
      title = ?,
      title_override = ?,
      title_zh = ?,
      author = ?,
      published = ?,
      tags = ?,
      manual_tags = ?,
      split_pages = ?,
      created = ?
    WHERE id = ?
    `,
  ).run(
    override || old.scanned_title || path.basename(old.path),
    override,
    input.titleZh ?? old.title_zh,
    input.author ?? old.author,
    input.published ?? old.published,
    JSON.stringify(
      input.tags === undefined ? old.tags : [...new Set(input.tags)],
    ),
    input.tags === undefined ? old.manual_tags : 1,
    Number(splitPages),
    input.created ?? old.created,
    req.params.id,
  );
  if (splitPagesChanged) {
    startMangaReprocess(String(req.params.id), splitPages);
  }
  res.json(detail(String(req.params.id)));
});

app.patch("/api/chapters/:id", (req, res) => {
  const { title } = z
    .object({ title: z.string().trim().max(200).nullable() })
    .parse(req.body);
  const old = db
    .prepare("SELECT path,scanned_title FROM chapters WHERE id=?")
    .get(req.params.id) as { path: string; scanned_title: string } | undefined;
  if (!old) {
    return res.status(404).json({ error: "章节不存在" });
  }
  db.prepare("UPDATE chapters SET title=?,title_override=? WHERE id=?").run(
    title || old.scanned_title || path.basename(old.path),
    title || null,
    req.params.id,
  );
  res.json({ ok: true });
});

app.delete("/api/manga/:id", (req, res) => {
  if (db.prepare("SELECT 1 FROM jobs WHERE status='running'").get()) {
    return res.status(409).json({ error: "请等待导入完成后再删除漫画" });
  }
  const manga = mangaForDeletion(String(req.params.id));
  if (!manga) {
    return res.status(404).json({ error: "漫画不存在" });
  }
  log.info("manga.delete.started", "正在删除漫画", {
    mangaId: manga.id,
    title: manga.title,
    path: manga.path,
    reason: "single",
  });
  removeMangaFiles(manga);
  db.prepare("DELETE FROM manga WHERE id=?").run(manga.id);
  log.info("manga.delete.completed", "漫画删除完成", {
    mangaId: manga.id,
    title: manga.title,
    reason: "single",
  });
  res.json({ ok: true });
});

app.put("/api/manga/:id/cover", (req, res) => {
  const m = detail(String(req.params.id));
  if (!m) {
    return res.status(404).json({ error: "漫画不存在" });
  }
  const page = m.chapters
    .flatMap((c: any) => c.pages)
    .find((p: any) => p.id === req.body.pageId);
  if (!page) {
    return res.status(400).json({ error: "请选择这部漫画的图片" });
  }
  db.prepare("UPDATE manga SET cover=? WHERE id=?").run(
    page.optimized,
    req.params.id,
  );
  res.json({ ok: true });
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 1 },
});

app.post("/api/manga/:id/cover", upload.single("cover"), async (req, res) => {
  if (!detail(String(req.params.id))) {
    return res.status(404).json({ error: "漫画不存在" });
  }
  if (!req.file) {
    return res.status(400).json({ error: "请选择图片" });
  }
  const name = `covers/${req.params.id}/${crypto.randomUUID()}.webp`;
  fs.mkdirSync(path.dirname(path.join(processedDir, name)), {
    recursive: true,
  });
  await sharp(req.file.buffer)
    .rotate()
    .resize({ width: 1000, withoutEnlargement: true })
    .webp({ quality: 88 })
    .toFile(path.join(processedDir, name));
  if (!detail(String(req.params.id))) {
    fs.rmSync(path.join(processedDir, name), { force: true });
    return res.status(404).json({ error: "漫画已删除" });
  }
  if (
    !canRead(res.locals.user.id, String(req.params.id)) ||
    !(
      db
        .prepare("SELECT is_admin FROM users WHERE id=?")
        .get(res.locals.user.id) as { is_admin: number }
    )?.is_admin
  ) {
    fs.rmSync(path.join(processedDir, name), { force: true });
    res.status(403).json({ error: "权限已变更" });
    return;
  }
  db.prepare("INSERT OR REPLACE INTO media_assets VALUES(?,?)").run(
    name,
    req.params.id,
  );
  db.prepare("UPDATE manga SET cover=? WHERE id=?").run(name, req.params.id);
  res.json({ ok: true });
});

app.get("/api/manga/:id/cover", async (req, res) => {
  const m = detail(String(req.params.id));
  if (!m) {
    return res.status(404).end();
  }
  const source = coverFile(m);
  if (!source) {
    return res.status(404).end();
  }
  let file = source;
  if (req.query.size === "small") {
    file = await smallCover(m.id, source);
    const current = detail(m.id);
    if (!current || !canRead(res.locals.user.id, m.id)) {
      if (!current) {
        fs.rmSync(path.join(processedDir, file), { force: true });
      }
      return res.status(404).end();
    }
    if (coverFile(current) !== source) {
      return res.status(409).json({ error: "封面已更新，请重试" });
    }
    db.prepare("INSERT OR REPLACE INTO media_assets VALUES(?,?)").run(
      file,
      m.id,
    );
  }
  res.sendFile(path.join(processedDir, file), { dotfiles: "allow" });
});

app.get("/api/directories", async (req, res) =>
  res.json(await browse(String(req.query.path || "."))),
);

app.get("/api/sources", (_req, res) => res.json(sourceList()));

app.post("/api/sources", async (req, res) => {
  const body = z
    .object({
      path: z.string().min(1),
      mode: z.enum(["manual", "one", "two"]),
      userIds: z.array(z.string().uuid()).max(10000).default([]),
    })
    .parse(req.body);
  const sourcePath = await relativePath(await safeDirectory(body.path));
  const id = crypto.randomUUID();
  db.transaction(() => {
    db.prepare("INSERT INTO sources(id,path,mode) VALUES(?,?,?)").run(
      id,
      sourcePath,
      body.mode,
    );
    setSourceUsers(id, body.userIds);
  })();
  log.info("source.created", "导入源已添加", {
    sourceId: id,
    path: sourcePath,
    mode: body.mode,
    userCount: new Set(body.userIds).size,
  });
  res.status(201).json({ id, path: sourcePath, mode: body.mode });
});

app.patch("/api/sources/:id", async (req, res) => {
  const body = z
    .object({
      path: z.string().min(1),
      mode: z.enum(["manual", "one", "two"]),
      userIds: z.array(z.string().uuid()).max(10000).default([]),
    })
    .parse(req.body);
  const sourcePath = await relativePath(await safeDirectory(body.path));
  if (
    db
      .prepare("SELECT 1 FROM jobs WHERE source_id=? AND status='running'")
      .get(req.params.id)
  ) {
    return res.status(409).json({ error: "请等待该目录导入完成" });
  }
  const result = db.transaction(() => {
    const result = db
      .prepare(
        `
      UPDATE sources
      SET
        path = ?,
        mode = ?,
        last_scan = CASE
          WHEN path <> ? OR mode <> ? THEN NULL
          ELSE last_scan
        END
      WHERE id = ?
      `,
      )
      .run(sourcePath, body.mode, sourcePath, body.mode, req.params.id);
    if (result.changes) {
      setSourceUsers(String(req.params.id), body.userIds);
    }
    return result;
  })();
  if (result.changes) {
    log.info("source.updated", "导入源设置已更新", {
      sourceId: String(req.params.id),
      path: sourcePath,
      mode: body.mode,
      userCount: new Set(body.userIds).size,
    });
  }
  res
    .status(result.changes ? 200 : 404)
    .json(result.changes ? { ok: true } : { error: "导入源不存在" });
});

app.get("/api/sources/:id/jobs", (req, res) =>
  res.json(
    db
      .prepare(
        "SELECT * FROM jobs WHERE source_id=? ORDER BY rowid DESC LIMIT 20",
      )
      .all(req.params.id),
  ),
);

app.delete("/api/sources/:id", (req, res) => {
  const input = z
    .object({ deleteManga: z.boolean().default(false) })
    .parse(req.body ?? {});
  const source = db
    .prepare("SELECT id,path,mode FROM sources WHERE id=?")
    .get(req.params.id) as
    { id: string; path: string; mode: string } | undefined;
  if (!source) {
    return res.status(404).json({ error: "导入源不存在" });
  }
  const running = input.deleteManga
    ? db.prepare("SELECT 1 FROM jobs WHERE status='running'").get()
    : db
        .prepare("SELECT 1 FROM jobs WHERE source_id=? AND status='running'")
        .get(req.params.id);
  if (running) {
    return res.status(409).json({
      error: input.deleteManga
        ? "请等待当前导入任务完成后再删除漫画"
        : "请等待该目录导入完成",
    });
  }
  const linkedCount = (
    db
      .prepare("SELECT COUNT(*) AS count FROM manga_sources WHERE source_id=?")
      .get(req.params.id) as { count: number }
  ).count;

  if (input.deleteManga) {
    const ids = (
      db
        .prepare(
          `
          SELECT ms.manga_id
          FROM manga_sources ms
          WHERE
            ms.source_id = ?
            AND NOT EXISTS (
              SELECT 1
              FROM manga_sources other
              WHERE
                other.manga_id = ms.manga_id
                AND other.source_id <> ms.source_id
            )
          `,
        )
        .all(req.params.id) as { manga_id: string }[]
    ).map((row) => row.manga_id);
    const manga = ids.map(mangaForDeletion).filter((item) => item !== null);
    for (const item of manga) {
      log.info("manga.delete.started", "正在删除漫画", {
        mangaId: item.id,
        title: item.title,
        path: item.path,
        reason: "source",
        sourceId: String(req.params.id),
      });
      removeMangaFiles(item);
    }
    const remove = db.prepare("DELETE FROM manga WHERE id=?");
    db.transaction(() => {
      for (const id of ids) {
        remove.run(id);
      }
      db.prepare("DELETE FROM sources WHERE id=?").run(req.params.id);
    })();
    log.info("source.deleted", "导入源及独有漫画已删除", {
      sourceId: String(req.params.id),
      path: source.path,
      mode: source.mode,
      deleteManga: true,
      deletedManga: ids.length,
      retainedManga: linkedCount - ids.length,
    });
    return res.json({
      ok: true,
      deletedManga: ids.length,
      retainedManga: linkedCount - ids.length,
    });
  }

  db.transaction(() => {
    db.prepare(
      `
      INSERT OR IGNORE INTO manga_users
      SELECT ms.manga_id, su.user_id
      FROM manga_sources ms
      JOIN source_users su ON su.source_id = ms.source_id
      WHERE ms.source_id = ?
      `,
    ).run(req.params.id);
    db.prepare("DELETE FROM sources WHERE id=?").run(req.params.id);
  })();
  log.info("source.deleted", "导入源已删除，漫画保留", {
    sourceId: String(req.params.id),
    path: source.path,
    mode: source.mode,
    deleteManga: false,
    retainedManga: linkedCount,
  });
  res.json({ ok: true, deletedManga: 0 });
});

app.post("/api/sources/:id/refresh", (req, res) => {
  const s = db
    .prepare("SELECT * FROM sources WHERE id=?")
    .get(req.params.id) as any;
  if (!s) {
    return res.status(404).json({ error: "导入源不存在" });
  }
  const { mode } = z
    .object({ mode: z.enum(["all", "new"]).default("all") })
    .parse(req.body ?? {});
  res.status(202).json({ id: startImport(s, mode) });
});

app.get("/api/jobs", (_req, res) =>
  res.json(
    db
      .prepare(
        "SELECT * FROM jobs WHERE status='running' OR id IN (SELECT id FROM jobs ORDER BY rowid DESC LIMIT 20) ORDER BY rowid DESC",
      )
      .all(),
  ),
);

app.use(
  "/media",
  (req, res, next) => {
    const file = decodeURIComponent(req.path).replace(/^\//, "");
    const asset = db
      .prepare("SELECT manga_id FROM media_assets WHERE file=?")
      .get(file) as { manga_id: string } | undefined;
    if (!asset || !canRead(res.locals.user.id, asset.manga_id)) {
      res.status(404).json({ error: "图片不存在或无权访问" });
      return;
    }
    next();
  },
  express.static(processedDir, {
    dotfiles: "deny",
    setHeaders: (res) => res.setHeader("Cache-Control", "private, no-store"),
  }),
);

app.use(express.static(path.resolve("dist"), { index: false }));

app.get("/{*path}", (req, res) => {
  if (req.path.startsWith("/api/") || req.path.startsWith("/media/")) {
    return res.status(404).json({ error: "未找到资源" });
  }
  res.sendFile(path.resolve("dist/index.html"));
});

app.use(
  (
    error: any,
    req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    const status =
      error instanceof z.ZodError
        ? 400
        : error.code === "SQLITE_CONSTRAINT_UNIQUE"
          ? 409
          : 400;
    log.warn("request.failed", "请求处理失败", {
      method: req.method,
      path: req.path,
      status,
      error: errorMessage(error),
    });
    res.status(status).json({
      error:
        error instanceof z.ZodError
          ? error.issues[0]?.message || "请检查输入内容"
          : error.code === "SQLITE_CONSTRAINT_UNIQUE"
            ? error.message.includes("users.email")
              ? "该邮箱已存在"
              : "该目录已添加为导入源"
            : error.message || "请求失败",
    });
  },
);

void upgradeImages().catch((error) => {
  log.error("images.upgrade.failed", "图片升级启动失败", {
    error: errorMessage(error),
  });
});

app.listen(
  Number(process.env.PORT || 3000),
  process.env.BIND_ADDRESS || "0.0.0.0",
  () =>
    log.info("server.started", "漫画阅读服务已启动", {
      bindAddress: process.env.BIND_ADDRESS || "0.0.0.0",
      port: Number(process.env.PORT || 3000),
      mangaDir,
      dataDir,
      processedDir,
    }),
);
