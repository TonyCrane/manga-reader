export interface Page {
  id: string;
  original: string | null;
  optimized: string;
  thumbnail?: string;
  width: number;
  height: number;
  source: string;
  part: string;
}

export interface Chapter {
  id: string;
  title: string;
  title_override: string | null;
  scanned_title: string;
  pages: Page[];
  position: number;
}

export interface Manga {
  id: string;
  title: string;
  title_zh: string;
  title_override: string | null;
  scanned_title: string;
  created: string;
  manual_tags: number;
  author: string;
  published: string;
  tags: string[];
  chapterCount: number;
  pageCount: number;
  split_pages: number;
  cover: string | null;
  chapters: Chapter[];
}

export interface Source {
  userIds: string[];
  id: string;
  path: string;
  mode: string;
  last_scan: string | null;
  image_count: number;
  image_bytes: number;
  stats_updated: string | null;
}

export interface Job {
  source_id: string | null;
  created: string;
  id: string;
  status: string;
  done: number;
  total: number;
  message: string;
  error: string | null;
}

export type LibrarySort =
  "title" | "author" | "count" | "pages" | "created" | "published";

export interface User {
  id: string;
  email: string;
  isAdmin: boolean;
  mustChangePassword: boolean;
  titleLanguage: "ja" | "zh";
  librarySort: LibrarySort;
  libraryAscending: boolean;
}

export type VersionInfo = {
  branch: string;
  sha: string;
  builtAt: string | null;
  docker: boolean;
};

export type AppConfig = {
  appName: string;
};

export type StorageBucket = {
  files: number;
  bytes: number;
};

export type StorageAnalysis = {
  scannedAt: string;
  total: StorageBucket;
  used: StorageBucket;
  reclaimable: StorageBucket;
  databaseStale: StorageBucket;
  orphaned: StorageBucket;
  missingFiles: number;
  kinds: Record<
    "original" | "optimized" | "preview" | "cover" | "other",
    { used: StorageBucket; reclaimable: StorageBucket }
  >;
};

export type StorageCleanupResult = {
  deleted: StorageBucket;
  analysis: StorageAnalysis;
};
