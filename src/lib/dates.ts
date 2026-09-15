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
