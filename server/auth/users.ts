import { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db } from "../library/database";
import { requireAdmin } from "./access";
import {
  emailSchema,
  passwordSchema,
  hashPassword,
  publicUser,
  type UserRow,
} from "./session";

export const userRoutes = Router();
userRoutes.use(requireAdmin);
userRoutes.get("/", (_req, res) =>
  res.json(
    (db.prepare("SELECT * FROM users ORDER BY email").all() as UserRow[]).map(
      publicUser,
    ),
  ),
);
userRoutes.post("/", async (req, res) => {
  const input = z
    .object({
      email: emailSchema,
      password: passwordSchema,
      isAdmin: z.boolean().default(false),
    })
    .parse(req.body);
  const passwordHash = await hashPassword(input.password);
  // Administrator privileges may have changed while deriving the hash.
  if (
    !(
      db
        .prepare("SELECT is_admin FROM users WHERE id=?")
        .get(res.locals.user.id) as UserRow
    )?.is_admin
  ) {
    res.status(403).json({ error: "需要管理员权限" });
    return;
  }
  const user: UserRow = {
    id: randomUUID(),
    email: input.email,
    password_hash: passwordHash,
    is_admin: Number(input.isAdmin),
    must_change_password: 1,
  };
  db.prepare("INSERT INTO users VALUES(?,?,?,?,?)").run(
    user.id,
    user.email,
    user.password_hash,
    user.is_admin,
    1,
  );
  res.status(201).json(publicUser(user));
});
userRoutes.patch("/:id", (req, res) => {
  const { isAdmin } = z.object({ isAdmin: z.boolean() }).parse(req.body);
  const user = db
    .prepare("SELECT * FROM users WHERE id=?")
    .get(req.params.id) as UserRow | undefined;
  if (!user) {
    res.status(404).json({ error: "用户不存在" });
    return;
  }
  if (
    user.is_admin &&
    !isAdmin &&
    (
      db.prepare("SELECT COUNT(*) count FROM users WHERE is_admin=1").get() as {
        count: number;
      }
    ).count === 1
  ) {
    res.status(409).json({ error: "至少保留一个管理员" });
    return;
  }
  db.prepare("UPDATE users SET is_admin=? WHERE id=?").run(
    Number(isAdmin),
    user.id,
  );
  res.json(publicUser({ ...user, is_admin: Number(isAdmin) }));
});
userRoutes.post("/:id/password", async (req, res) => {
  const { password } = z.object({ password: passwordSchema }).parse(req.body);
  const passwordHash = await hashPassword(password);
  if (
    !(
      db
        .prepare("SELECT is_admin FROM users WHERE id=?")
        .get(res.locals.user.id) as UserRow
    )?.is_admin
  ) {
    res.status(403).json({ error: "需要管理员权限" });
    return;
  }
  const result = db.transaction(() => {
    const result = db
      .prepare(
        "UPDATE users SET password_hash=?,must_change_password=1 WHERE id=?",
      )
      .run(passwordHash, req.params.id);
    db.prepare("DELETE FROM sessions WHERE user_id=?").run(req.params.id);
    return result;
  })();
  res
    .status(result.changes ? 200 : 404)
    .json(result.changes ? { ok: true } : { error: "用户不存在" });
});
