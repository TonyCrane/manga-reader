import { availableParallelism } from "node:os";

// Sharp runs these jobs in its native worker pool; bound both CPU and memory use.
export const imageConcurrency = Math.max(
  1,
  Math.min(4, availableParallelism()),
);

export async function mapConcurrent<T, R>(
  items: readonly T[],
  limit: number,
  run: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  let failed = false;
  let failure: unknown;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (!failed && cursor < items.length) {
        const index = cursor++;
        try {
          results[index] = await run(items[index], index);
        } catch (error) {
          failed = true;
          failure = error;
        }
      }
    }),
  );
  // Wait for in-flight work before releasing the import lock.
  if (failed) {
    throw failure;
  }
  return results;
}
