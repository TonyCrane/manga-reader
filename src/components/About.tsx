import { useEffect, useState } from "react";
import { Tag } from "lucide-react";
import { api } from "../lib/api";
import type { VersionInfo } from "../types";

export function About() {
  const [version, setVersion] = useState<VersionInfo | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    api<VersionInfo>("/version", { signal: controller.signal })
      .then(setVersion)
      .catch((error: Error) => {
        if (!controller.signal.aborted) setError(error.message);
      });
    return () => controller.abort();
  }, [attempt]);
  return (
    <div className="about-content">
      <div className="about-version">
        <h4>
          <Tag size={20} aria-hidden="true" />
          版本信息
        </h4>
        {version ? (
          <>
            <div className="version-badge">
              <span aria-hidden="true" />
              {version.branch}#{version.sha.slice(0, 7)}
            </div>
            <dl className="version-details">
              <div>
                <dt>{version.docker ? "镜像构建时间" : "运行方式"}</dt>
                <dd>
                  {version.builtAt ? (
                    <time dateTime={version.builtAt}>
                      {new Date(version.builtAt).toLocaleString("zh-CN", {
                        hour12: false,
                      })}
                    </time>
                  ) : version.docker ? (
                    "未知"
                  ) : (
                    "本地运行 · 未构建 Docker 镜像"
                  )}
                </dd>
              </div>
            </dl>
          </>
        ) : error ? (
          <div role="alert">
            <p className="error">{error}</p>
            <button
              className="soft-button"
              onClick={() => setAttempt(attempt + 1)}
            >
              重试
            </button>
          </div>
        ) : (
          <p className="muted" role="status">
            正在读取版本信息…
          </p>
        )}
      </div>
    </div>
  );
}
