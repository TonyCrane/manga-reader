import { Router, type RequestHandler, type Response } from "express";
import rateLimit from "express-rate-limit";
import {
  randomBytes,
  randomUUID,
  scrypt,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { promisify } from "node:util";
import { z } from "zod";
import { db } from "./db";

const derive = promisify(scrypt);
export const passwordSchema = z
  .string()
  .min(8, "密码至少 8 位")
  .max(128, "密码最多 128 位");
export const emailSchema = z
  .string()
  .trim()
  .email("请输入有效邮箱")
  .max(254)
  .transform((value) => value.toLowerCase());
const credentials = z.object({ email: emailSchema, password: passwordSchema });
export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  is_admin: number;
  must_change_password: number;
}
type UserPreferencesRow = {
  library_sort: string | null;
  library_ascending: number | null;
  title_language: "ja" | "zh" | null;
};
type UserWithPreferences = UserRow & Partial<UserPreferencesRow>;
const librarySort = z.enum([
  "title",
  "author",
  "count",
  "pages",
  "created",
  "published",
]);
export const publicUser = (user: UserWithPreferences) => {
  const joinedPreferences = Object.hasOwn(user, "library_sort");
  const preferences = joinedPreferences
    ? user
    : (db
        .prepare(
          "SELECT library_sort,library_ascending,title_language FROM user_preferences WHERE user_id=?",
        )
        .get(user.id) as UserPreferencesRow | undefined);
  return {
    id: user.id,
    email: user.email,
    isAdmin: !!user.is_admin,
    mustChangePassword: !!user.must_change_password,
    titleLanguage: preferences?.title_language || "ja",
    librarySort: preferences?.library_sort || "title",
    libraryAscending:
      preferences?.library_ascending == null
        ? true
        : !!preferences.library_ascending,
  };
};
const cookie = {
  httpOnly: true,
  sameSite: "strict" as const,
  secure: process.env.COOKIE_SECURE === "true",
  path: "/",
};
const tokenHash = (token: string) =>
  createHash("sha256").update(token).digest("hex");
const sessionUser = db.prepare(`
  SELECT
    u.*,
    p.library_sort,
    p.library_ascending,
    p.title_language
  FROM users u
  JOIN sessions s ON s.user_id = u.id
  LEFT JOIN user_preferences p ON p.user_id = u.id
  WHERE s.token = ? AND s.expires > ?
`);

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const key = (await derive(password, salt, 64)) as Buffer;
  return `${salt}:${key.toString("hex")}`;
}
async function verify(password: string, encoded: string) {
  const [salt, hex] = encoded.split(":");
  const expected = Buffer.from(hex, "hex");
  const actual = (await derive(password, salt, 64)) as Buffer;
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
function issueSession(res: Response, user: UserRow) {
  const token = randomBytes(32).toString("hex");
  db.prepare("DELETE FROM sessions WHERE expires<?").run(Date.now());
  db.prepare("INSERT INTO sessions(token,expires,user_id) VALUES(?,?,?)").run(
    tokenHash(token),
    Date.now() + 30 * 86400000,
    user.id,
  );
  res
    .cookie("session", token, { ...cookie, maxAge: 30 * 86400000 })
    .json({ user: publicUser(user) });
}

export const publicAuth = Router();
publicAuth.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});
publicAuth.get("/setup", (_req, res) =>
  res.json({ needsSetup: !db.prepare("SELECT 1 FROM users LIMIT 1").get() }),
);
const authLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "尝试过于频繁，请稍后再试" },
});
publicAuth.post("/setup", authLimit, async (req, res) => {
  if (db.prepare("SELECT 1 FROM users LIMIT 1").get()) {
    res.status(409).json({ error: "管理员账号已初始化" });
    return;
  }
  const input = credentials.parse(req.body);
  const passwordHash = await hashPassword(input.password);
  const user = {
    id: randomUUID(),
    email: input.email,
    password_hash: passwordHash,
    is_admin: 1,
    must_change_password: 0,
  };
  const created = db.transaction(() => {
    if (db.prepare("SELECT 1 FROM users LIMIT 1").get()) {
      return false;
    }
    db.prepare("INSERT INTO users VALUES(?,?,?,?,?)").run(
      user.id,
      user.email,
      user.password_hash,
      1,
      0,
    );
    return true;
  })();
  if (!created) {
    res.status(409).json({ error: "管理员账号已初始化" });
    return;
  }
  issueSession(res, user);
});
const dummyHash = `${"0".repeat(32)}:${"0".repeat(128)}`;
publicAuth.post("/login", authLimit, async (req, res) => {
  const input = credentials.parse(req.body);
  const user = db
    .prepare("SELECT * FROM users WHERE email=?")
    .get(input.email) as UserRow | undefined;
  const valid = await verify(input.password, user?.password_hash || dummyHash);
  // Recheck the credential after asynchronous hashing so resets cannot race login.
  const current =
    user &&
    (db.prepare("SELECT * FROM users WHERE id=?").get(user.id) as
      UserRow | undefined);
  if (!valid || !current || current.password_hash !== user?.password_hash) {
    res.status(401).json({ error: "邮箱或密码不正确" });
    return;
  }
  issueSession(res, current);
});

export const authenticate: RequestHandler = (req, res, next) => {
  res.setHeader("Cache-Control", "private, no-store");
  const token = req.cookies.session;
  const user =
    typeof token === "string"
      ? (sessionUser.get(tokenHash(token), Date.now()) as
          UserWithPreferences | undefined)
      : undefined;
  if (!user) {
    res.status(401).json({ error: "请先登录" });
    return;
  }
  res.locals.user = publicUser(user);
  res.locals.userRow = user;
  next();
};
export const requirePasswordChanged: RequestHandler = (_req, res, next) => {
  if (res.locals.user.mustChangePassword) {
    res
      .status(403)
      .json({ error: "请先修改初始密码", code: "PASSWORD_CHANGE_REQUIRED" });
    return;
  }
  next();
};
export const accountRoutes = Router();
accountRoutes.get("/session", (_req, res) =>
  res.json({ user: res.locals.user }),
);
accountRoutes.post("/logout", (req, res) => {
  db.prepare("DELETE FROM sessions WHERE token=?").run(
    tokenHash(req.cookies.session),
  );
  res.clearCookie("session", cookie).json({ ok: true });
});
accountRoutes.patch(
  "/account/preferences",
  requirePasswordChanged,
  (req, res) => {
    const input = z
      .object({
        sort: librarySort.optional(),
        ascending: z.boolean().optional(),
        titleLanguage: z.enum(["ja", "zh"]).optional(),
      })
      .parse(req.body);
    const current = publicUser(res.locals.userRow);
    db.prepare(
      `
      INSERT INTO user_preferences (
        user_id, library_sort, library_ascending, title_language
      )
      VALUES (?,?,?,?)
      ON CONFLICT(user_id) DO UPDATE SET
        library_sort = excluded.library_sort,
        library_ascending = excluded.library_ascending,
        title_language = excluded.title_language
      `,
    ).run(
      res.locals.user.id,
      input.sort ?? current.librarySort,
      Number(input.ascending ?? current.libraryAscending),
      input.titleLanguage ?? current.titleLanguage,
    );
    res.json({ ok: true });
  },
);
accountRoutes.post("/account/password", authLimit, async (req, res) => {
  const input = z
    .object({ currentPassword: z.string().max(128), password: passwordSchema })
    .parse(req.body);
  const user = res.locals.userRow as UserRow;
  if (!(await verify(input.currentPassword, user.password_hash))) {
    res.status(400).json({ error: "当前密码不正确" });
    return;
  }
  if (input.password === input.currentPassword) {
    res.status(400).json({ error: "新密码不能与当前密码相同" });
    return;
  }
  const passwordHash = await hashPassword(input.password);
  const updated = db.transaction(() => {
    const result = db
      .prepare(
        "UPDATE users SET password_hash=?,must_change_password=0 WHERE id=? AND password_hash=?",
      )
      .run(passwordHash, user.id, user.password_hash);
    if (!result.changes) {
      return false;
    }
    db.prepare("DELETE FROM sessions WHERE user_id=?").run(user.id);
    return true;
  })();
  if (!updated) {
    res.status(409).json({ error: "密码已变更，请重新登录" });
    return;
  }
  const current = db
    .prepare("SELECT * FROM users WHERE id=?")
    .get(user.id) as UserRow;
  issueSession(res, current);
});
