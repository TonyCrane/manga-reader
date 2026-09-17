import crypto from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { setSourceUsers, sourceList } from "../auth/access";
import { mangaForDeletion, removeMangaFiles } from "../library/assets";
import { db } from "../library/database";
import {
  browse,
  relativePath,
  safeDirectory,
  startImport,
} from "../library/importer";
import { log } from "../shared/log";

export const sourceRoutes = Router();

sourceRoutes.get("/directories", async (req, res) =>
  res.json(await browse(String(req.query.path || "."))),
);

sourceRoutes.get("/sources", (_req, res) => res.json(sourceList()));

sourceRoutes.post("/sources", async (req, res) => {
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
  res.status(201).json({
    id,
    path: sourcePath,
    mode: body.mode,
    last_scan: null,
    image_count: 0,
    image_bytes: 0,
    stats_updated: null,
    userIds: [...new Set(body.userIds)],
  });
});

sourceRoutes.patch("/sources/:id", async (req, res) => {
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

sourceRoutes.get("/sources/:id/jobs", (req, res) =>
  res.json(
    db
      .prepare(
        "SELECT * FROM jobs WHERE source_id=? ORDER BY rowid DESC LIMIT 20",
      )
      .all(req.params.id),
  ),
);

sourceRoutes.delete("/sources/:id", (req, res) => {
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

sourceRoutes.post("/sources/:id/refresh", (req, res) => {
  const source = db
    .prepare("SELECT * FROM sources WHERE id=?")
    .get(req.params.id) as any;
  if (!source) {
    return res.status(404).json({ error: "导入源不存在" });
  }
  const { mode } = z
    .object({ mode: z.enum(["all", "new"]).default("all") })
    .parse(req.body ?? {});
  res.status(202).json({ id: startImport(source, mode) });
});

sourceRoutes.get("/jobs", (_req, res) =>
  res.json(
    db
      .prepare(
        "SELECT * FROM jobs WHERE status='running' OR id IN (SELECT id FROM jobs ORDER BY rowid DESC LIMIT 20) ORDER BY rowid DESC",
      )
      .all(),
  ),
);
