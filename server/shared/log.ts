type LogLevel = "info" | "warn" | "error";

type LogFields = Record<string, string | number | boolean | null | undefined>;

function write(
  level: LogLevel,
  event: string,
  message: string,
  fields: LogFields = {},
) {
  const contextFields: LogFields = { event, ...fields };
  const context = Object.entries(contextFields)
    .flatMap(([key, value]) =>
      value === undefined
        ? []
        : [
            `${key}=${typeof value === "string" ? JSON.stringify(value) : String(value)}`,
          ],
    )
    .join("  ");
  const readableMessage = message.replace(/\s+/g, " ").trim();
  const line = `${new Date().toISOString()} [${level.toUpperCase()}] ${readableMessage}  ${context}`;
  if (level === "error") {
    console.error(line);
    return;
  }
  if (level === "warn") {
    console.warn(line);
    return;
  }
  console.log(line);
}

export const log = {
  info: (event: string, message: string, fields?: LogFields) =>
    write("info", event, message, fields),
  warn: (event: string, message: string, fields?: LogFields) =>
    write("warn", event, message, fields),
  error: (event: string, message: string, fields?: LogFields) =>
    write("error", event, message, fields),
};

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
