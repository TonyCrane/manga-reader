import { execFileSync } from "node:child_process";
import fs from "node:fs";

function git(...args: string[]) {
  try {
    return execFileSync("git", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "unknown";
  }
}

// Docker writes immutable metadata into the image; local runs read the checkout.
const metadataPath = new URL("../build-info.json", import.meta.url);
export const versionInfo = fs.existsSync(metadataPath)
  ? JSON.parse(fs.readFileSync(metadataPath, "utf8"))
  : {
      branch: git("rev-parse", "--abbrev-ref", "HEAD"),
      sha: git("rev-parse", "HEAD"),
      builtAt: null,
      docker: false,
    };
