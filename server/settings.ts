import { db } from "./db";

export const defaultAppName = "manga-reader";

const readSetting = db.prepare(
  "SELECT value FROM system_settings WHERE key = ?",
);
const writeSetting = db.prepare(`
  INSERT INTO system_settings (key, value)
  VALUES (?, ?)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value
`);

export function getAppConfig() {
  const setting = readSetting.get("app_name") as { value: string } | undefined;
  return { appName: setting?.value || defaultAppName };
}

export function setAppName(appName: string) {
  writeSetting.run("app_name", appName);
  return getAppConfig();
}
