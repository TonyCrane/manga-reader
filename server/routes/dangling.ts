import { Router } from "express";
import { z } from "zod";
import { canRead } from "../auth/access";
import {
  mangaForDeletion,
  mangaIdSchema,
  removeChapterFiles,
  removeMangaFiles,
} from "../library/assets";
import { analyzeDangling, type DanglingAnalysis } from "../library/dangling";
import { db } from "../library/database";
import { isImporterBusy } from "../library/importer";
import {
  beginStorageMaintenance,
  isStorageMaintenanceBusy,
} from "../library/storage";
import { log } from "../shared/log";

export const danglingRoutes = Router();

function readableDangling(analysis: DanglingAnalysis, userId: string) {
  const access = new Map<string, boolean>();
  const readable = (mangaId: string) => {
    if (!access.has(mangaId)) {
      access.set(mangaId, canRead(userId, mangaId));
    }
    return access.get(mangaId) || false;
  };
  return {
    ...analysis,
    manga: analysis.manga.filter((manga) => readable(manga.id)),
    chapters: analysis.chapters.filter((chapter) => readable(chapter.mangaId)),
  };
}

danglingRoutes.get("/", async (_req, res) => {
  if (isImporterBusy() || isStorageMaintenanceBusy()) {
    return res.status(409).json({ error: "请等待当前图片任务完成" });
  }
  res.json(readableDangling(await analyzeDangling(), res.locals.user.id));
});

danglingRoutes.delete("/", async (req, res) => {
  if (isImporterBusy() || isStorageMaintenanceBusy()) {
    return res.status(409).json({ error: "请等待当前图片任务完成" });
  }
  const input = z
    .object({
      mangaIds: z.array(mangaIdSchema).max(500).default([]),
      chapterIds: z.array(mangaIdSchema).max(500).default([]),
    })
    .refine(
      ({ mangaIds, chapterIds }) => mangaIds.length + chapterIds.length > 0,
      "请至少选择一项悬垂内容",
    )
    .refine(
      ({ mangaIds, chapterIds }) => mangaIds.length + chapterIds.length <= 500,
      "一次最多删除 500 项",
    )
    .parse(req.body);
  const mangaIds = [...new Set(input.mangaIds)];
  const chapterIds = [...new Set(input.chapterIds)];
  const finishMaintenance = beginStorageMaintenance();
  try {
    const current = readableDangling(
      await analyzeDangling(),
      res.locals.user.id,
    );
    const danglingManga = new Map(
      current.manga.map((manga) => [manga.id, manga]),
    );
    const danglingChapters = new Map(
      current.chapters.map((chapter) => [chapter.id, chapter]),
    );
    if (
      mangaIds.some((id) => !danglingManga.has(id)) ||
      chapterIds.some((id) => !danglingChapters.has(id))
    ) {
      return res.status(409).json({
        error: "悬垂内容已经变化，请重新扫描后再删除",
      });
    }
    const selectedManga = new Set(mangaIds);
    const chapters = chapterIds
      .map((id) => danglingChapters.get(id)!)
      .filter((chapter) => !selectedManga.has(chapter.mangaId));
    const manga = mangaIds.map((id) => mangaForDeletion(id)!);
    for (const item of manga) {
      removeMangaFiles(item);
    }
    for (const chapter of chapters) {
      removeChapterFiles(chapter.id);
    }
    const removeManga = db.prepare("DELETE FROM manga WHERE id=?");
    const clearCover = db.prepare(
      "UPDATE manga SET cover=NULL WHERE id=? AND cover GLOB ?",
    );
    const removeChapterAssets = db.prepare(
      "DELETE FROM media_assets WHERE manga_id=? AND file GLOB ?",
    );
    const removeChapter = db.prepare("DELETE FROM chapters WHERE id=?");
    db.transaction(() => {
      for (const chapter of chapters) {
        const pattern = `${chapter.id}/*`;
        clearCover.run(chapter.mangaId, pattern);
        removeChapterAssets.run(chapter.mangaId, pattern);
        removeChapter.run(chapter.id);
      }
      for (const item of manga) {
        removeManga.run(item.id);
      }
      for (const mangaId of new Set(
        chapters.map((chapter) => chapter.mangaId),
      )) {
        const remaining = db
          .prepare(
            "SELECT id FROM chapters WHERE manga_id=? ORDER BY position,rowid",
          )
          .all(mangaId) as { id: string }[];
        const updatePosition = db.prepare(
          "UPDATE chapters SET position=? WHERE id=?",
        );
        remaining.forEach((chapter, index) =>
          updatePosition.run(index, chapter.id),
        );
      }
    })();
    log.info("dangling.deleted", "悬垂内容已删除", {
      mangaCount: manga.length,
      chapterCount: chapters.length,
    });
    const analysis = readableDangling(
      await analyzeDangling(),
      res.locals.user.id,
    );
    res.json({
      deletedManga: manga.length,
      deletedChapters: chapters.length,
      analysis,
    });
  } finally {
    finishMaintenance();
  }
});
