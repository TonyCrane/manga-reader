type LogLevel = "info" | "warn" | "error";

type LogFields = Record<string, string | number | boolean | null | undefined>;

function write(
  level: LogLevel,
  event: string,
  message: string,
  fields: LogFields = {},
) {
  const record = {
    time: new Date().toISOString(),
    level,
    event,
    message,
    ...fields,
  };
  const line = JSON.stringify(record);
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
