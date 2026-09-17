import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { mapConcurrent } from "./concurrency";
import { db, processedDir } from "./db";
import { log } from "./log";

type StorageBucket = {
  files: number;
  bytes: number;
};

type StorageKind = "original" | "optimized" | "preview" | "cover" | "other";

type StorageKindAnalysis = {
  used: StorageBucket;
  reclaimable: StorageBucket;
};

export type StorageAnalysis = {
  scannedAt: string;
  total: StorageBucket;
  used: StorageBucket;
  reclaimable: StorageBucket;
  databaseStale: StorageBucket;
  orphaned: StorageBucket;
  missingFiles: number;
  kinds: Record<StorageKind, StorageKindAnalysis>;
};

type StoredPage = {
  original?: string | null;
  optimized?: string;
  thumbnail?: string;
};

type DiskFile = {
  file: string;
  size: number;
  kind: StorageKind;
  used: boolean;
  registered: boolean;
};

type StorageScan = {
  analysis: StorageAnalysis;
  directories: string[];
  files: DiskFile[];
  protectedFiles: Set<string>;
  registeredFiles: Set<string>;
};

const emptyBucket = (): StorageBucket => ({ files: 0, bytes: 0 });

const emptyKinds = (): Record<StorageKind, StorageKindAnalysis> => ({
  original: { used: emptyBucket(), reclaimable: emptyBucket() },
  optimized: { used: emptyBucket(), reclaimable: emptyBucket() },
  preview: { used: emptyBucket(), reclaimable: emptyBucket() },
  cover: { used: emptyBucket(), reclaimable: emptyBucket() },
  other: { used: emptyBucket(), reclaimable: emptyBucket() },
});

function add(bucket: StorageBucket, size: number) {
  bucket.files++;
  bucket.bytes += size;
}

export function coverThumbnailFile(mangaId: string, source: string) {
  const signature = crypto
    .createHash("sha256")
    .update(`v1:480x640:${source}`)
    .digest("hex")
    .slice(0, 24);
  return path.join("covers", mangaId, `thumbnail-${signature}.webp`);
}

function storageKind(file: string): StorageKind {
  const name = path.basename(file);
  if (name === "page.png") {
    return "original";
  }
  if (name === "page.webp") {
    return "optimized";
  }
  if (name === "preview.webp") {
    return "preview";
  }
  if (file.startsWith(`covers${path.sep}`)) {
    return "cover";
  }
  return "other";
}

function activeFiles() {
  const requiredFiles = new Set<string>();
  const protectedFiles = new Set<string>();
  const protect = (file: unknown, required = true) => {
    if (typeof file !== "string" || !file) {
      return;
    }
    protectedFiles.add(file);
    if (required) {
      requiredFiles.add(file);
    }
  };
  for (const row of db.prepare("SELECT pages FROM chapters").all() as {
    pages: string;
  }[]) {
    for (const page of JSON.parse(row.pages) as StoredPage[]) {
      protect(page.original);
      protect(page.optimized);
      protect(page.thumbnail);
    }
  }
  const covers = db
    .prepare(
      `
      SELECT
        m.id,
        m.cover,
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
      `,
    )
    .all() as { id: string; cover: string | null; source: string | null }[];
  for (const manga of covers) {
    protect(manga.cover);
    if (manga.source) {
      protect(coverThumbnailFile(manga.id, manga.source), false);
    }
  }
  return { protectedFiles, requiredFiles };
}

async function diskFiles() {
  const directories = [""];
  const files: { file: string; size: number; kind: StorageKind }[] = [];
  let cursor = 0;
  while (cursor < directories.length) {
    const batch = directories.slice(cursor, cursor + 32);
    cursor += batch.length;
    const listings = await mapConcurrent(batch, 16, async (relative) => ({
      relative,
      entries: await fs.readdir(path.join(processedDir, relative), {
        withFileTypes: true,
      }),
    }));
    const discovered: string[] = [];
    for (const listing of listings) {
      for (const entry of listing.entries) {
        const relative = listing.relative
          ? path.join(listing.relative, entry.name)
          : entry.name;
        if (entry.isDirectory()) {
          directories.push(relative);
        } else if (entry.isFile()) {
          discovered.push(relative);
        }
      }
    }
    files.push(
      ...(await mapConcurrent(discovered, 32, async (file) => ({
        file,
        size: (await fs.stat(path.join(processedDir, file))).size,
        kind: storageKind(file),
      }))),
    );
  }
  return { directories: directories.slice(1), files };
}

async function scanStorage(): Promise<StorageScan> {
  const { protectedFiles, requiredFiles } = activeFiles();
  const registeredFiles = new Set(
    (
      db.prepare("SELECT file FROM media_assets").all() as { file: string }[]
    ).map((row) => row.file),
  );
  const disk = await diskFiles();
  const present = new Set<string>();
  const analysis: StorageAnalysis = {
    scannedAt: new Date().toISOString(),
    total: emptyBucket(),
    used: emptyBucket(),
    reclaimable: emptyBucket(),
    databaseStale: emptyBucket(),
    orphaned: emptyBucket(),
    missingFiles: 0,
    kinds: emptyKinds(),
  };
  const files = disk.files.map((file): DiskFile => {
    present.add(file.file);
    const used = protectedFiles.has(file.file);
    const registered = registeredFiles.has(file.file);
    add(analysis.total, file.size);
    if (used) {
      add(analysis.used, file.size);
      add(analysis.kinds[file.kind].used, file.size);
    } else {
      add(analysis.reclaimable, file.size);
      add(analysis.kinds[file.kind].reclaimable, file.size);
      add(registered ? analysis.databaseStale : analysis.orphaned, file.size);
    }
    return { ...file, used, registered };
  });
  analysis.missingFiles = [...requiredFiles].filter(
    (file) => !present.has(file),
  ).length;
  return {
    analysis,
    directories: disk.directories,
    files,
    protectedFiles,
    registeredFiles,
  };
}

let maintenanceBusy = false;
let activeWriters = 0;

export const isStorageMaintenanceBusy = () => maintenanceBusy;

export function beginStorageWrite() {
  if (maintenanceBusy) {
    throw Error("空间清理正在进行，请稍后再试");
  }
  activeWriters++;
  let finished = false;
  return () => {
    if (!finished) {
      finished = true;
      activeWriters--;
    }
  };
}

export async function analyzeStorage() {
  return (await scanStorage()).analysis;
}

async function removeEmptyDirectories(directories: string[]) {
  const byDepth = new Map<number, string[]>();
  for (const directory of directories) {
    const depth = directory.split(path.sep).length;
    const group = byDepth.get(depth) || [];
    group.push(directory);
    byDepth.set(depth, group);
  }
  const depths = [...byDepth.keys()].sort((a, b) => b - a);
  for (const depth of depths) {
    await mapConcurrent(byDepth.get(depth) || [], 32, async (directory) => {
      try {
        await fs.rmdir(path.join(processedDir, directory));
      } catch (error) {
        if (
          !error ||
          typeof error !== "object" ||
          !("code" in error) ||
          !["ENOENT", "ENOTEMPTY"].includes(String(error.code))
        ) {
          throw error;
        }
      }
    });
  }
}

function cleanedAnalysis(before: StorageAnalysis): StorageAnalysis {
  const kinds = emptyKinds();
  for (const [kind, value] of Object.entries(before.kinds) as [
    StorageKind,
    StorageKindAnalysis,
  ][]) {
    kinds[kind].used = { ...value.used };
  }
  return {
    scannedAt: new Date().toISOString(),
    total: { ...before.used },
    used: { ...before.used },
    reclaimable: emptyBucket(),
    databaseStale: emptyBucket(),
    orphaned: emptyBucket(),
    missingFiles: before.missingFiles,
    kinds,
  };
}

export async function cleanupStorage() {
  if (maintenanceBusy || activeWriters > 0) {
    throw Error("有图片正在写入，请稍后再试");
  }
  maintenanceBusy = true;
  try {
    const scan = await scanStorage();
    const removable = scan.files.filter((file) => !file.used);
    await mapConcurrent(removable, 16, async (file) => {
      await fs.rm(path.join(processedDir, file.file), { force: true });
    });
    const staleRows = [...scan.registeredFiles].filter(
      (file) => !scan.protectedFiles.has(file),
    );
    const removeAsset = db.prepare("DELETE FROM media_assets WHERE file=?");
    db.transaction(() => {
      for (const file of staleRows) {
        removeAsset.run(file);
      }
    })();
    await removeEmptyDirectories(scan.directories);
    log.info("storage.cleanup.completed", "无用处理图片清理完成", {
      deletedFiles: scan.analysis.reclaimable.files,
      deletedBytes: scan.analysis.reclaimable.bytes,
      removedAssetRecords: staleRows.length,
    });
    return {
      deleted: { ...scan.analysis.reclaimable },
      analysis: cleanedAnalysis(scan.analysis),
    };
  } finally {
    maintenanceBusy = false;
  }
}
