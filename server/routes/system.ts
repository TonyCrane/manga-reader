import { Router } from "express";
import { z } from "zod";
import { requireAdmin } from "../auth/access";
import { userRoutes } from "../auth/users";
import { getAppConfig, setAppName } from "../system/settings";
import { translationRoutes } from "../system/translation";
import { versionInfo } from "../system/version";

export const publicSystemRoutes = Router();
export const systemRoutes = Router();

publicSystemRoutes.get("/health", (_req, res) => res.json({ ok: true }));

publicSystemRoutes.get("/config", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json(getAppConfig());
});

systemRoutes.use("/account/translation", requireAdmin, translationRoutes);

systemRoutes.put("/system-settings", requireAdmin, (req, res) => {
  const { appName } = z
    .object({
      appName: z
        .string()
        .trim()
        .min(1, "请输入应用名称")
        .max(50, "应用名称最多 50 个字符"),
    })
    .parse(req.body);
  res.json(setAppName(appName));
});

systemRoutes.get("/version", (_req, res) => res.json(versionInfo));
systemRoutes.use("/users", userRoutes);
