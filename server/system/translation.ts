import { Router } from "express";
import { z } from "zod";
import { db } from "../library/database";

export const translationRoutes = Router();
const settingsSchema = z
  .object({
    apiKey: z.string().trim().min(1).max(512),
    model: z.string().trim().min(1).max(100),
    prompt: z.string().trim().min(1).max(4000),
  })
  .strict();

translationRoutes.get("/", (_req, res) => {
  const settings = db
    .prepare(
      `
    SELECT api_key AS apiKey, model, prompt
    FROM translation_settings WHERE user_id = ?
  `,
    )
    .get(res.locals.user.id);
  res.json(settings || null);
});

translationRoutes.put("/", (req, res) => {
  const settings = settingsSchema.parse(req.body);
  db.prepare(
    `
    INSERT INTO translation_settings (user_id, api_key, model, prompt)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      api_key = excluded.api_key,
      model = excluded.model,
      prompt = excluded.prompt
  `,
  ).run(res.locals.user.id, settings.apiKey, settings.model, settings.prompt);
  res.json({ ok: true });
});

translationRoutes.delete("/", (_req, res) => {
  db.prepare("DELETE FROM translation_settings WHERE user_id = ?").run(
    res.locals.user.id,
  );
  res.json({ ok: true });
});
