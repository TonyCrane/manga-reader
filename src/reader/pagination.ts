// A spread belongs to one chapter; null is a physical white endpaper.
export function spreads(count: number, shifted: boolean): (number | null)[][] {
  const pages: (number | null)[] = Array.from({ length: count }, (_, i) => i);
  if (shifted) {
    pages.unshift(null);
  }
  if (pages.length % 2) {
    pages.push(null);
  }
  const result: (number | null)[][] = [];
  for (let i = 0; i < pages.length; i += 2) {
    result.push(pages.slice(i, i + 2));
  }
  return result;
}

export function spreadIndex(page: number, shifted: boolean) {
  return Math.floor((page + (shifted ? 1 : 0)) / 2);
}
