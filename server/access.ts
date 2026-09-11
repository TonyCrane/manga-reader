import type { RequestHandler } from "express";
import { db } from "./db";

export function canRead(userId: string, mangaId: string): boolean {
  return !!db
    .prepare(
      `
    SELECT 1 FROM manga WHERE id = ? AND (
      EXISTS (
        SELECT 1 FROM manga_sources ms
        JOIN source_users su ON su.source_id = ms.source_id
        WHERE ms.manga_id = manga.id AND su.user_id = ?
      ) OR EXISTS (
        SELECT 1 FROM manga_users mu
        WHERE mu.manga_id = manga.id AND mu.user_id = ?
      )
    )
  `,
    )
    .get(mangaId, userId, userId);
}

export const requireAdmin: RequestHandler = (_req, res, next) => {
  if (!res.locals.user.isAdmin) {
    res.status(403).json({ error: "需要管理员权限" });
    return;
  }
  next();
};

export function sourceList() {
  return (
    db.prepare("SELECT * FROM sources ORDER BY rowid").all() as { id: string }[]
  ).map((source) => ({
    ...source,
    userIds: (
      db
        .prepare("SELECT user_id FROM source_users WHERE source_id=?")
        .all(source.id) as { user_id: string }[]
    ).map((row) => row.user_id),
  }));
}

export function setSourceUsers(sourceId: string, userIds: string[]) {
  for (const id of userIds) {
    if (!db.prepare("SELECT 1 FROM users WHERE id=?").get(id)) {
      throw Error("所选用户不存在");
    }
  }
  db.prepare("DELETE FROM source_users WHERE source_id=?").run(sourceId);
  for (const id of new Set(userIds)) {
    db.prepare("INSERT INTO source_users VALUES(?,?)").run(sourceId, id);
  }
}
