import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { z } from "zod";
import { db, processedDir } from "./database";
import { beginStorageWrite, coverThumbnailFile } from "./storage";

export const mangaIdSchema = z
  .string()
  .regex(/^[a-f0-9]{24}$/, "无效的漫画 ID");

export type MangaForDeletion = {
  id: string;
  title: string;
  path: string;
  cover: string | null;
  chapterIds: string[];
};

export function mangaForDeletion(id: string): MangaForDeletion | null {
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

export function removeMangaFiles(manga: MangaForDeletion) {
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

export function removeChapterFiles(chapterId: string) {
  if (!mangaIdSchema.safeParse(chapterId).success) {
    throw Error("无效的章节 ID");
  }
  fs.rmSync(path.join(processedDir, chapterId), {
    recursive: true,
    force: true,
  });
}

export async function smallCover(mangaId: string, source: string) {
  const name = coverThumbnailFile(mangaId, source);
  const directory = path.dirname(name);
  const output = path.join(processedDir, name);
  if (!fs.existsSync(output) || fs.statSync(output).size === 0) {
    const finishWrite = beginStorageWrite();
    try {
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
    } finally {
      finishWrite();
    }
  }
  return name;
}
