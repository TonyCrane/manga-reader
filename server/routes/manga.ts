import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Router } from "express";
import multer from "multer";
import sharp from "sharp";
import { z } from "zod";
import { canRead, requireAdmin } from "../auth/access";
import {
  mangaForDeletion,
  mangaIdSchema,
  removeMangaFiles,
  smallCover,
  type MangaForDeletion,
} from "../library/assets";
import {
  coverSource,
  db,
  detail,
  mangaList,
  processedDir,
} from "../library/database";
import {
  isImporterBusy,
  safeDirectory,
  startMangaReprocess,
} from "../library/importer";
import { beginStorageWrite } from "../library/storage";
import { log } from "../shared/log";

export const mangaRoutes = Router();

mangaRoutes.use("/manga/:id", (req, res, next) => {
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

mangaRoutes.get("/chapters/:id/pages/:pageId/original", async (req, res) => {
  if (
    !mangaIdSchema.safeParse(req.params.id).success ||
    !mangaIdSchema.safeParse(req.params.pageId).success
  ) {
    return res.status(404).end();
  }
  const chapter = db
    .prepare("SELECT manga_id,path,pages FROM chapters WHERE id=?")
    .get(req.params.id) as
    { manga_id: string; path: string; pages: string } | undefined;
  if (!chapter || !canRead(res.locals.user.id, chapter.manga_id)) {
    return res.status(404).end();
  }
  const page = (
    JSON.parse(chapter.pages) as {
      id: string;
      original: string | null;
      source: string;
    }[]
  ).find((item) => item.id === req.params.pageId);
  if (
    !page ||
    page.original ||
    !page.source ||
    path.basename(page.source) !== page.source
  ) {
    return res.status(404).end();
  }
  try {
    const directory = await safeDirectory(chapter.path);
    const source = await fs.promises.realpath(
      path.join(directory, page.source),
    );
    if (path.dirname(source) !== directory) {
      return res.status(404).end();
    }
    res.setHeader("Cache-Control", "private, no-store");
    res.sendFile(source, { dotfiles: "allow" });
  } catch {
    res.status(404).end();
  }
});

mangaRoutes.use("/chapters/:id", requireAdmin, (req, res, next) => {
  const chapter = db
    .prepare("SELECT manga_id FROM chapters WHERE id=?")
    .get(req.params.id) as { manga_id: string } | undefined;
  if (!chapter || !canRead(res.locals.user.id, chapter.manga_id)) {
    res.status(404).json({ error: "章节不存在或无权访问" });
    return;
  }
  next();
});

mangaRoutes.get("/manga", (_req, res) =>
  res.json(mangaList(res.locals.user.id)),
);

mangaRoutes.delete("/manga", requireAdmin, (req, res) => {
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

mangaRoutes.get("/manga/:id", (req, res) => {
  const manga = detail(String(req.params.id));
  if (!manga) {
    return res.status(404).json({ error: "漫画不存在" });
  }
  res.json(manga);
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

mangaRoutes.patch("/manga/:id", (req, res) => {
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

mangaRoutes.patch("/chapters/:id", (req, res) => {
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

mangaRoutes.delete("/manga/:id", (req, res) => {
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

mangaRoutes.put("/manga/:id/cover", (req, res) => {
  const manga = detail(String(req.params.id));
  if (!manga) {
    return res.status(404).json({ error: "漫画不存在" });
  }
  const page = manga.chapters
    .flatMap((chapter: any) => chapter.pages)
    .find((item: any) => item.id === req.body.pageId);
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

mangaRoutes.post(
  "/manga/:id/cover",
  upload.single("cover"),
  async (req, res) => {
    if (!detail(String(req.params.id))) {
      return res.status(404).json({ error: "漫画不存在" });
    }
    if (!req.file) {
      return res.status(400).json({ error: "请选择图片" });
    }
    const finishWrite = beginStorageWrite();
    try {
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
      db.prepare("UPDATE manga SET cover=? WHERE id=?").run(
        name,
        req.params.id,
      );
      res.json({ ok: true });
    } finally {
      finishWrite();
    }
  },
);

mangaRoutes.get("/manga/:id/cover", async (req, res) => {
  const manga = coverSource(String(req.params.id));
  if (!manga?.source) {
    return res.status(404).end();
  }
  const source = manga.source;
  let file = source;
  if (req.query.size === "small") {
    file = await smallCover(manga.id, source);
    const current = coverSource(manga.id);
    if (!current || !canRead(res.locals.user.id, manga.id)) {
      if (!current) {
        fs.rmSync(path.join(processedDir, file), { force: true });
      }
      return res.status(404).end();
    }
    if (current.source !== source) {
      return res.status(409).json({ error: "封面已更新，请重试" });
    }
    db.prepare("INSERT OR REPLACE INTO media_assets VALUES(?,?)").run(
      file,
      manga.id,
    );
  }
  res.sendFile(path.join(processedDir, file), { dotfiles: "allow" });
});
