import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import sharp from "sharp";
import { processedDir } from "./db";
import { imageConcurrency, mapConcurrent } from "./concurrency";

sharp.concurrency(1);
export const hash = (value: string) =>
  crypto.createHash("sha256").update(value).digest("hex").slice(0, 24);

export async function outputsExist(files: string[]) {
  return (
    await mapConcurrent(files, 8, async (file) => {
      try {
        return (await fs.stat(path.join(processedDir, file))).size > 0;
      } catch {
        return false;
      }
    })
  ).every(Boolean);
}

export async function processChapter(
  chapterId: string,
  files: string[],
  signatures: string[],
  sizes: number[],
  onFile: (reused: boolean) => void,
) {
  const metadata = await mapConcurrent(
    files,
    imageConcurrency,
    async (file) => {
      const data = await sharp(file).metadata();
      const rotated = data.orientation && data.orientation >= 5;
      const width = (rotated ? data.height : data.width)!;
      const height = (rotated ? data.width : data.height)!;
      if (!width || !height) {
        throw Error(`无法识别图片 ${file}`);
      }
      return { width, height, spread: width > height };
    },
  );
  const parts = metadata.map(({ width, height, spread }) =>
    spread
      ? [
          {
            left: Math.floor(width / 2),
            width: width - Math.floor(width / 2),
            height,
            part: "right",
          },
          { left: 0, width: Math.floor(width / 2), height, part: "left" },
        ]
      : [{ left: 0, width, height, part: "single" }],
  );
  const ratio = parts
    .flat()
    .reduce(
      (ratio, part) => Math.min(ratio, part.width / part.height),
      Infinity,
    );
  const pages = await mapConcurrent(
    files,
    imageConcurrency,
    async (file, index) => {
      const result = [];
      let reused = true;
      for (const part of parts[index]) {
        const canvasHeight = Math.ceil(part.width / ratio);
        // A chapter edit only invalidates this page when its source or output geometry changes.
        const signature = hash(
          `v2:${signatures[index]}:${part.left}:${part.width}:${canvasHeight}`,
        );
        const directory = path.join(chapterId, signature);
        const original = path.join(directory, "page.png");
        const optimized = path.join(directory, "page.webp");
        if (!(await outputsExist([original, optimized]))) {
          reused = false;
          await fs.mkdir(path.join(processedDir, directory), {
            recursive: true,
          });
          const padding = canvasHeight - part.height;
          const { data, info } = await sharp(file)
            .rotate()
            .extract({
              left: part.left,
              top: 0,
              width: part.width,
              height: part.height,
            })
            .extend({
              top: Math.floor(padding / 2),
              bottom: Math.ceil(padding / 2),
              left: 0,
              right: 0,
              background: "#000",
            })
            .raw()
            .toBuffer({ resolveWithObject: true });
          const normalized = sharp(data, { raw: info });
          const small = sizes[index] < 300 * 1024 && part.width <= 1600;
          const originalTemp = path.join(
            processedDir,
            directory,
            "pending.png",
          );
          const optimizedTemp = path.join(
            processedDir,
            directory,
            "pending.webp",
          );
          const outcomes = await Promise.allSettled([
            normalized.clone().png().toFile(originalTemp),
            normalized
              .clone()
              .resize({ width: 1600, withoutEnlargement: true })
              .webp(small ? { lossless: true } : { quality: 85, effort: 4 })
              .toFile(optimizedTemp),
          ]);
          const failure = outcomes.find(
            (outcome) => outcome.status === "rejected",
          );
          if (failure?.status === "rejected") {
            throw failure.reason;
          }
          await fs.rename(originalTemp, path.join(processedDir, original));
          await fs.rename(optimizedTemp, path.join(processedDir, optimized));
        }
        result.push({
          id: hash(`${chapterId}:${path.basename(file)}:${part.left}`),
          original,
          optimized,
          width: part.width,
          height: canvasHeight,
          source: path.basename(file),
          part: part.part,
        });
      }
      onFile(reused);
      return result;
    },
  );
  return pages.flat();
}
