import path from "node:path";
import cookieParser from "cookie-parser";
import express from "express";
import { z } from "zod";
import { canReadMedia, requireAdmin } from "./auth/access";
import {
  accountRoutes,
  authenticate,
  publicAuth,
  requirePasswordChanged,
} from "./auth/session";
import { processedDir } from "./library/database";
import { danglingRoutes } from "./routes/dangling";
import { mangaRoutes } from "./routes/manga";
import { sourceRoutes } from "./routes/sources";
import { storageRoutes } from "./routes/storage";
import { publicSystemRoutes, systemRoutes } from "./routes/system";
import { errorMessage, log } from "./shared/log";
import { getAppConfig } from "./system/settings";

export function createApp() {
  const app = express();

  app.disable("x-powered-by");
  app.use(express.json({ limit: "128kb" }), cookieParser());

  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader("X-Frame-Options", "DENY");
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      req.headers.origin &&
      new URL(req.headers.origin).host !== req.headers.host
    ) {
      return res.status(403).json({ error: "不允许跨站请求" });
    }
    next();
  });

  app.use("/api", publicSystemRoutes);
  app.get("/manifest.webmanifest", (_req, res) => {
    const { appName } = getAppConfig();
    res.setHeader("Cache-Control", "no-store");
    res.type("application/manifest+json").json({
      id: "/",
      name: appName,
      short_name: appName,
      lang: "zh-CN",
      description: "属于你的私人漫画书架",
      start_url: "/",
      scope: "/",
      display: "standalone",
      background_color: "#f8f9fc",
      theme_color: "#f8f9fc",
      icons: [
        {
          src: "/icon-192.png",
          sizes: "192x192",
          type: "image/png",
          purpose: "any",
        },
        {
          src: "/icon-512.png",
          sizes: "512x512",
          type: "image/png",
          purpose: "any maskable",
        },
      ],
    });
  });

  app.use("/api", publicAuth);
  app.use(["/api", "/media"], authenticate);
  app.use("/api", accountRoutes);
  app.use(["/api", "/media"], requirePasswordChanged);
  app.use("/api", systemRoutes);

  app.use(["/api/sources", "/api/jobs", "/api/directories"], requireAdmin);
  app.use("/api/storage", requireAdmin, storageRoutes);
  app.use("/api/dangling", requireAdmin, danglingRoutes);
  app.use("/api", mangaRoutes);
  app.use("/api", sourceRoutes);

  app.use(
    "/media",
    (req, res, next) => {
      const file = decodeURIComponent(req.path).replace(/^\//, "");
      if (!canReadMedia(res.locals.user.id, file)) {
        res.status(404).json({ error: "图片不存在或无权访问" });
        return;
      }
      next();
    },
    express.static(processedDir, {
      dotfiles: "deny",
      setHeaders: (res) => res.setHeader("Cache-Control", "private, no-store"),
    }),
  );

  app.use(express.static(path.resolve("dist"), { index: false }));

  app.get("/{*path}", (req, res) => {
    if (req.path.startsWith("/api/") || req.path.startsWith("/media/")) {
      return res.status(404).json({ error: "未找到资源" });
    }
    res.sendFile(path.resolve("dist/index.html"));
  });

  app.use(
    (
      error: any,
      req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      const status =
        error instanceof z.ZodError
          ? 400
          : error.code === "SQLITE_CONSTRAINT_UNIQUE"
            ? 409
            : 400;
      log.warn("request.failed", "请求处理失败", {
        method: req.method,
        path: req.path,
        status,
        error: errorMessage(error),
      });
      res.status(status).json({
        error:
          error instanceof z.ZodError
            ? error.issues[0]?.message || "请检查输入内容"
            : error.code === "SQLITE_CONSTRAINT_UNIQUE"
              ? error.message.includes("users.email")
                ? "该邮箱已存在"
                : "该目录已添加为导入源"
              : error.message || "请求失败",
      });
    },
  );

  return app;
}
