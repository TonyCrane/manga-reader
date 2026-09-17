import fs from "node:fs/promises";
import type { Dirent } from "node:fs";
import path from "node:path";
import { mapConcurrent } from "./concurrency";
import { db, mangaDir } from "./db";

const imageExtension = /\.(jpe?g|png|webp|avif|tiff?|gif)$/i;
const naturalOrder = new Intl.Collator("en", { numeric: true });

export type DanglingReason =
  "manga_missing" | "missing_directory" | "no_images" | "structure_changed";

export type DanglingManga = {
  id: string;
  title: string;
  path: string;
  chapterCount: number;
  reason: "missing_directory";
};

export type DanglingChapter = {
  id: string;
  mangaId: string;
  mangaTitle: string;
  title: string;
  path: string;
  pageCount: number;
  reason: DanglingReason;
};

export type DanglingAnalysis = {
  scannedAt: string;
  manga: DanglingManga[];
  chapters: DanglingChapter[];
};

type MangaRow = {
  id: string;
  title: string;
  path: string;
  chapter_count: number;
};

type ChapterRow = {
  id: string;
  manga_id: string;
  manga_title: string;
  title: string;
  path: string;
  page_count: number;
};

type MangaScan = {
  exists: boolean;
  validChapterPaths: Set<string>;
};

const isMissing = (error: unknown) =>
  Boolean(
    error &&
    typeof error === "object" &&
    "code" in error &&
    ["ENOENT", "ENOTDIR"].includes(String(error.code)),
  );

function recordPath(root: string, storedPath: string) {
  const absolute = path.resolve(root, storedPath);
  if (absolute !== root && !absolute.startsWith(root + path.sep)) {
    return null;
  }
  return absolute;
}

async function directoryEntries(absolute: string) {
  try {
    if (!(await fs.lstat(absolute)).isDirectory()) {
      return null;
    }
    return await fs.readdir(absolute, { withFileTypes: true });
  } catch (error) {
    if (isMissing(error)) {
      return null;
    }
    throw error;
  }
}

async function recordDirectoryEntries(root: string, storedPath: string) {
  const absolute = recordPath(root, storedPath);
  if (!absolute) {
    return null;
  }
  const relative = path.relative(root, absolute);
  let current = root;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    try {
      if (!(await fs.lstat(current)).isDirectory()) {
        return null;
      }
    } catch (error) {
      if (isMissing(error)) {
        return null;
      }
      throw error;
    }
  }
  const entries = await directoryEntries(absolute);
  return entries ? { absolute, entries } : null;
}

const containsImages = (entries: Dirent<string>[]) =>
  entries.some((entry) => entry.isFile() && imageExtension.test(entry.name));

async function scanManga(root: string, manga: MangaRow): Promise<MangaScan> {
  const directory = await recordDirectoryEntries(root, manga.path);
  if (!directory) {
    return { exists: false, validChapterPaths: new Set() };
  }
  const { absolute, entries } = directory;
  const childDirectories = entries.filter(
    (entry) => entry.isDirectory() && !entry.name.startsWith("."),
  );
  const validChapterPaths = new Set<string>();
  if (childDirectories.length === 0) {
    if (containsImages(entries)) {
      validChapterPaths.add(path.relative(root, absolute) || ".");
    }
    return { exists: true, validChapterPaths };
  }
  const children = await mapConcurrent(childDirectories, 8, async (entry) => {
    const child = path.join(absolute, entry.name);
    const childEntries = await directoryEntries(child);
    return childEntries && containsImages(childEntries)
      ? path.relative(root, child) || "."
      : null;
  });
  for (const child of children) {
    if (child) {
      validChapterPaths.add(child);
    }
  }
  return { exists: true, validChapterPaths };
}

async function invalidChapterReason(
  root: string,
  chapter: ChapterRow,
): Promise<DanglingReason> {
  const directory = await recordDirectoryEntries(root, chapter.path);
  if (!directory) {
    return "missing_directory";
  }
  return containsImages(directory.entries) ? "structure_changed" : "no_images";
}

export async function analyzeDangling(): Promise<DanglingAnalysis> {
  const root = await fs.realpath(mangaDir);
  const manga = db
    .prepare(
      `
      SELECT m.id,m.title,m.path,COUNT(c.id) AS chapter_count
      FROM manga m
      LEFT JOIN chapters c ON c.manga_id=m.id
      GROUP BY m.id
      ORDER BY m.rowid
      `,
    )
    .all() as MangaRow[];
  const chapters = db
    .prepare(
      `
      SELECT
        c.id,
        c.manga_id,
        m.title AS manga_title,
        c.title,
        c.path,
        c.page_count
      FROM chapters c
      JOIN manga m ON m.id=c.manga_id
      ORDER BY m.rowid,c.position,c.rowid
      `,
    )
    .all() as ChapterRow[];
  const scans = await mapConcurrent(manga, 8, (item) => scanManga(root, item));
  const scansByManga = new Map(
    manga.map((item, index) => [item.id, scans[index]]),
  );
  const danglingManga = manga
    .filter((item) => !scansByManga.get(item.id)?.exists)
    .map((item): DanglingManga => ({
      id: item.id,
      title: item.title,
      path: item.path,
      chapterCount: item.chapter_count,
      reason: "missing_directory",
    }));
  const danglingChapters = (
    await mapConcurrent(chapters, 32, async (chapter) => {
      const mangaScan = scansByManga.get(chapter.manga_id);
      const normalizedPath = recordPath(root, chapter.path);
      const storedPath = normalizedPath
        ? path.relative(root, normalizedPath) || "."
        : chapter.path;
      if (mangaScan?.exists && mangaScan.validChapterPaths.has(storedPath)) {
        return null;
      }
      const reason = mangaScan?.exists
        ? await invalidChapterReason(root, chapter)
        : "manga_missing";
      return {
        id: chapter.id,
        mangaId: chapter.manga_id,
        mangaTitle: chapter.manga_title,
        title: chapter.title,
        path: chapter.path,
        pageCount: chapter.page_count,
        reason,
      } satisfies DanglingChapter;
    })
  )
    .filter((chapter): chapter is DanglingChapter => chapter !== null)
    .sort(
      (a, b) =>
        naturalOrder.compare(a.mangaTitle, b.mangaTitle) ||
        naturalOrder.compare(a.path, b.path),
    );
  danglingManga.sort((a, b) => naturalOrder.compare(a.path, b.path));
  return {
    scannedAt: new Date().toISOString(),
    manga: danglingManga,
    chapters: danglingChapters,
  };
}
