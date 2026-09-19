export function parseTimestamp(value: string): number {
  return Date.parse(
    value.includes("T") ? value : value.replace(" ", "T") + "Z",
  );
}

export function localDateTime(value: string): string {
  const date = new Date(parseTimestamp(value));
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}

export function chineseDateTime(value: string): string {
  const date = new Date(parseTimestamp(value));
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}年${pad(date.getMonth() + 1)}月${pad(
    date.getDate(),
  )}日 ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
