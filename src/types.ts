export interface Page {
  id: string;
  original: string;
  optimized: string;
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
  title_override: string | null;
  scanned_title: string;
  created: string;
  manual_tags: number;
  author: string;
  published: string;
  tags: string[];
  chapterCount: number;
  cover: string | null;
  chapters: Chapter[];
}

export interface Source {
  userIds: string[];
  id: string;
  path: string;
  mode: string;
  last_scan: string | null;
}

export interface Job {
  source_id: string;
  created: string;
  id: string;
  status: string;
  done: number;
  total: number;
  message: string;
  error: string | null;
}

export type LibrarySort =
  "title" | "author" | "count" | "created" | "published";

export interface User {
  id: string;
  email: string;
  isAdmin: boolean;
  mustChangePassword: boolean;
  librarySort: LibrarySort;
  libraryAscending: boolean;
}
