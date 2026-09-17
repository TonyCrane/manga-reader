import { Router } from "express";
import { isImporterBusy } from "../library/importer";
import {
  analyzeStorage,
  cleanupStorage,
  isStorageMaintenanceBusy,
} from "../library/storage";

export const storageRoutes = Router();

storageRoutes.get("/", async (_req, res) => {
  if (isImporterBusy() || isStorageMaintenanceBusy()) {
    return res.status(409).json({ error: "请等待当前图片任务完成" });
  }
  res.json(await analyzeStorage());
});

storageRoutes.post("/cleanup", async (_req, res) => {
  if (isImporterBusy() || isStorageMaintenanceBusy()) {
    return res.status(409).json({ error: "请等待当前图片任务完成" });
  }
  res.json(await cleanupStorage());
});
