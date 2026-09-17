import { createApp } from "./app";
import { dataDir, mangaDir, processedDir } from "./library/database";
import { upgradeImages, upgradeSourceStats } from "./library/importer";
import { errorMessage, log } from "./shared/log";

const app = createApp();

void (async () => {
  try {
    await upgradeImages();
  } catch (error) {
    log.error("images.upgrade.failed", "图片升级启动失败", {
      error: errorMessage(error),
    });
  }
  await upgradeSourceStats();
})();

const port = Number(process.env.PORT || 3000);
const bindAddress = process.env.BIND_ADDRESS || "0.0.0.0";

app.listen(port, bindAddress, () =>
  log.info("server.started", "漫画阅读服务已启动", {
    bindAddress,
    port,
    mangaDir,
    dataDir,
    processedDir,
  }),
);
