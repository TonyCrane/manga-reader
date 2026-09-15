import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import sharp from "sharp";
import { processedDir } from "./db";
import { imageConcurrency, mapConcurrent } from "./concurrency";

sharp.concurrency(1);
export const hash = (value: string) =>
  crypto.createHash("sha256").update(value).digest("hex").slice(0, 24);

export const chapterProcessingVersion = "v5";

export const chapterProcessingKey = (splitPages: boolean) =>
  splitPages ? chapterProcessingVersion : `${chapterProcessingVersion}:whole`;

export const chapterFingerprint = (signatures: string[], splitPages: boolean) =>
  hash(`${chapterProcessingKey(splitPages)}:${signatures.join("|")}`);

const doublePageAspectRatio = 1.2;

type PagePart = {
  left: number;
  width: number;
  height: number;
  part: string;
};

function splitPage(width: number, height: number): PagePart[] {
  const count =
    width > height * 2 ? 4 : width / height >= doublePageAspectRatio ? 2 : 1;
  if (count === 1) {
    return [{ left: 0, width, height, part: "single" }];
  }

  return Array.from({ length: count }, (_, outputIndex) => {
    const sourceIndex = count - outputIndex - 1;
    const left = Math.floor((width * sourceIndex) / count);
    const right = Math.floor((width * (sourceIndex + 1)) / count);
    return {
      left,
      width: right - left,
      height,
      part:
        count === 2
          ? outputIndex === 0
            ? "right"
            : "left"
          : `quarter-${outputIndex + 1}`,
    };
  });
}

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
  splitPages: boolean,
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
      return { width, height };
    },
  );
  const parts = metadata.map(({ width, height }) =>
    splitPages
      ? splitPage(width, height)
      : [{ left: 0, width, height, part: "single" }],
  );
  const pages = await mapConcurrent(
    files,
    imageConcurrency,
    async (file, index) => {
      const result = [];
      let reused = true;
      for (const part of parts[index]) {
        const signature = hash(
          `${chapterProcessingKey(splitPages)}:${signatures[index]}:${part.left}:${part.width}:${part.height}`,
        );
        const directory = path.join(chapterId, signature);
        const original = path.join(directory, "page.png");
        const optimized = path.join(directory, "page.webp");
        const thumbnail = path.join(directory, "preview.webp");
        if (!(await outputsExist([original, optimized, thumbnail]))) {
          reused = false;
          await fs.mkdir(path.join(processedDir, directory), {
            recursive: true,
          });
          const { data, info } = await sharp(file)
            .rotate()
            .extract({
              left: part.left,
              top: 0,
              width: part.width,
              height: part.height,
            })
            .raw()
            .toBuffer({ resolveWithObject: true });
          const normalized = sharp(data, { raw: info });
          const small = sizes[index] < 300 * 1024 && part.width <= 1600;
          const optimizedImage = normalized.clone();
          if (part.width > 1600 || part.height > 16000) {
            optimizedImage.resize(
              part.width / 1600 >= part.height / 16000
                ? { width: 1600, withoutEnlargement: true }
                : { height: 16000, withoutEnlargement: true },
            );
          }
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
          const thumbnailTemp = path.join(
            processedDir,
            directory,
            "pending-preview.webp",
          );
          const outcomes = await Promise.allSettled([
            normalized.clone().png().toFile(originalTemp),
            normalized
              .clone()
              .resize({
                width: 240,
                height: 360,
                fit: "inside",
                withoutEnlargement: true,
              })
              .webp({ quality: 65, effort: 4 })
              .toFile(thumbnailTemp),
            optimizedImage
              .webp(small ? { lossless: true } : { quality: 85, effort: 4 })
              .toFile(optimizedTemp),
          ]);
          const failure = outcomes.find(
            (outcome) => outcome.status === "rejected",
          );
          if (failure?.status === "rejected") {
            throw failure.reason;
          }
          await fs.rename(thumbnailTemp, path.join(processedDir, thumbnail));
          await fs.rename(originalTemp, path.join(processedDir, original));
          await fs.rename(optimizedTemp, path.join(processedDir, optimized));
        }
        result.push({
          id: hash(
            `${chapterId}:${path.basename(file)}:${splitPages ? part.left : "whole"}`,
          ),
          original,
          optimized,
          thumbnail,
          width: part.width,
          height: part.height,
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
