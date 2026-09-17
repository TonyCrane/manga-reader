import { useEffect, useState, useRef } from "react";
import {
  Folder,
  RefreshCw,
  Plus,
  ChevronRight,
  ArrowLeft,
  Trash2,
  Settings2,
  HardDrive,
  Unlink,
} from "lucide-react";
import { api, json } from "../lib/api";
import type {
  AppConfig,
  Source,
  Job,
  StorageAnalysis,
  StorageBucket,
  StorageCleanupResult,
  DanglingAnalysis,
  DanglingDeleteResult,
  DanglingReason,
} from "../types";
import { useAccount } from "../context/AccountContext";
import { UserManagement } from "../components/UserManagement";
import { Link } from "react-router-dom";
import type { User } from "../types";
import { Sheet } from "../components/Sheet";
import { parseTimestamp } from "../lib/dates";

const modes: Record<string, string> = {
  manual: "指定漫画",
  one: "一层扫描",
  two: "二层扫描",
};

const storageKinds: [keyof StorageAnalysis["kinds"], string][] = [
  ["original", "拆分页无损原图"],
  ["optimized", "优化阅读图"],
  ["preview", "页面预览图"],
  ["cover", "封面与缩略图"],
  ["other", "其他文件"],
];

const danglingReasons: Record<DanglingReason, string> = {
  manga_missing: "所属漫画目录不存在",
  missing_directory: "目录不存在",
  no_images: "目录中已无图片",
  structure_changed: "已不属于当前章节结构",
};

function formatBytes(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ["KiB", "MiB", "GiB", "TiB"];
  let value = bytes / 1024;
  let unit = units[0];
  for (let index = 1; index < units.length && value >= 1024; index++) {
    value /= 1024;
    unit = units[index];
  }
  return `${value >= 10 ? value.toFixed(1) : value.toFixed(2)} ${unit}`;
}

function duration(seconds: number) {
  const rounded = Math.max(1, Math.ceil(seconds));
  if (rounded < 60) {
    return `${rounded} 秒`;
  }
  if (rounded < 3600) {
    return `${Math.ceil(rounded / 60)} 分钟`;
  }
  if (rounded < 86400) {
    const totalMinutes = Math.ceil(rounded / 60);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return minutes ? `${hours} 小时 ${minutes} 分钟` : `${hours} 小时`;
  }
  const totalHours = Math.ceil(rounded / 3600);
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  return hours ? `${days} 天 ${hours} 小时` : `${days} 天`;
}

function jobEstimate(job: Job) {
  if (job.total <= 0) {
    return {
      percent: job.status === "completed" ? 100 : 0,
      remaining: job.status === "running" ? "正在统计图片" : "",
    };
  }
  const completed = Math.min(job.done, job.total);
  const percent = Math.floor((completed / job.total) * 100);
  if (job.status !== "running") {
    return { percent, remaining: "" };
  }
  if (completed <= 0) {
    return { percent, remaining: "正在估算剩余时间" };
  }
  const elapsed = (Date.now() - parseTimestamp(job.created)) / 1000;
  if (!Number.isFinite(elapsed) || elapsed <= 0) {
    return { percent, remaining: "正在估算剩余时间" };
  }
  const remaining = ((job.total - completed) * elapsed) / completed;
  return {
    percent,
    remaining: remaining > 0 ? `预计剩余 ${duration(remaining)}` : "即将完成",
  };
}

export function SystemSettings({
  appName,
  onAppNameChanged,
}: {
  appName: string;
  onAppNameChanged: (appName: string) => void;
}) {
  const { user } = useAccount();
  const [name, setName] = useState(appName);
  const [savingName, setSavingName] = useState(false);
  const [nameError, setNameError] = useState("");
  const [nameSaved, setNameSaved] = useState(false);
  const [users, setUsers] = useState<User[]>([]);
  const [userIds, setUserIds] = useState<string[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [error, setError] = useState("");
  const [refreshSource, setRefreshSource] = useState<Source | null>(null);
  const [adding, setAdding] = useState(false);
  const [editingSource, setEditingSource] = useState<Source | null>(null);
  const [deletingSource, setDeletingSource] = useState<Source | null>(null);
  const [history, setHistory] = useState<Job[]>([]);
  const [storage, setStorage] = useState<StorageAnalysis | null>(null);
  const [storageLoading, setStorageLoading] = useState(false);
  const [storageError, setStorageError] = useState("");
  const [cleanupOpen, setCleanupOpen] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [cleanupResult, setCleanupResult] = useState<StorageBucket | null>(
    null,
  );
  const [dangling, setDangling] = useState<DanglingAnalysis | null>(null);
  const [danglingLoading, setDanglingLoading] = useState(false);
  const [danglingError, setDanglingError] = useState("");
  const [selectedDanglingManga, setSelectedDanglingManga] = useState(
    () => new Set<string>(),
  );
  const [selectedDanglingChapters, setSelectedDanglingChapters] = useState(
    () => new Set<string>(),
  );
  const [danglingDeleteOpen, setDanglingDeleteOpen] = useState(false);
  const [deletingDangling, setDeletingDangling] = useState(false);
  const [danglingDeleted, setDanglingDeleted] = useState<{
    manga: number;
    chapters: number;
  } | null>(null);
  const observedJobs = useRef(new Set<string>());
  async function refresh(id: string, mode: "all" | "new" = "all") {
    const job = await api<{ id: string }>(
      `/sources/${id}/refresh`,
      json("POST", { mode }),
    );
    observedJobs.current.add(job.id);
  }
  async function openSource(source: Source | null) {
    setEditingSource(source);
    setUserIds(source?.userIds || [user.id]);
    setPath(source?.path || "");
    setMode(source?.mode || "one");
    setBrowser(null);
    setError("");
    setHistory([]);
    setAdding(true);
    if (source) {
      try {
        setHistory(await api<Job[]>(`/sources/${source.id}/jobs`));
      } catch (e) {
        setError((e as Error).message);
      }
    }
  }

  const [path, setPath] = useState("");
  const [mode, setMode] = useState("one");
  const [busy, setBusy] = useState(false);
  const [browser, setBrowser] = useState<{
    path: string;
    root: string;
    directories: string[];
  } | null>(null);
  const load = async () => {
    try {
      const [s, j, u] = await Promise.all([
        api<Source[]>("/sources"),
        api<Job[]>("/jobs"),
        api<User[]>("/users"),
      ]);
      setSources(s);
      setUsers(u);
      for (const job of j) {
        if (job.status === "running") {
          observedJobs.current.add(job.id);
        }
      }
      setJobs(j);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  async function loadStorage() {
    setStorageLoading(true);
    setStorageError("");
    try {
      setStorage(await api<StorageAnalysis>("/storage"));
    } catch (error) {
      setStorageError((error as Error).message);
    } finally {
      setStorageLoading(false);
    }
  }
  async function loadDangling() {
    setDanglingLoading(true);
    setDanglingError("");
    try {
      const analysis = await api<DanglingAnalysis>("/dangling");
      setDangling(analysis);
      const mangaIds = new Set(analysis.manga.map((manga) => manga.id));
      const chapterIds = new Set(
        analysis.chapters.map((chapter) => chapter.id),
      );
      setSelectedDanglingManga(
        (current) => new Set([...current].filter((id) => mangaIds.has(id))),
      );
      setSelectedDanglingChapters(
        (current) => new Set([...current].filter((id) => chapterIds.has(id))),
      );
    } catch (error) {
      setDanglingError((error as Error).message);
    } finally {
      setDanglingLoading(false);
    }
  }
  useEffect(() => {
    void load();
    void loadStorage();
    void loadDangling();
    const timer = setInterval(load, 1500);
    return () => clearInterval(timer);
  }, []);
  const active = jobs.some((j) => j.status === "running");
  const danglingMangaIds = new Set(
    dangling?.manga.map((manga) => manga.id) || [],
  );
  const independentlySelectedChapters = [...selectedDanglingChapters].filter(
    (id) => {
      const chapter = dangling?.chapters.find((item) => item.id === id);
      return chapter && !selectedDanglingManga.has(chapter.mangaId);
    },
  );
  const danglingSelectionCount =
    selectedDanglingManga.size + independentlySelectedChapters.length;
  const allDanglingSelected = Boolean(
    dangling &&
    dangling.manga.every((manga) => selectedDanglingManga.has(manga.id)) &&
    dangling.chapters
      .filter((chapter) => !danglingMangaIds.has(chapter.mangaId))
      .every((chapter) => selectedDanglingChapters.has(chapter.id)),
  );
  async function perform(fn: () => Promise<unknown>) {
    setError("");
    setBusy(true);
    try {
      await fn();
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function browse(p = ".") {
    try {
      setBrowser(await api(`/directories?path=${encodeURIComponent(p)}`));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function toggleDanglingManga(id: string, selected: boolean) {
    setSelectedDanglingManga((current) => {
      const next = new Set(current);
      selected ? next.add(id) : next.delete(id);
      return next;
    });
    if (selected) {
      setSelectedDanglingChapters((current) => {
        const next = new Set(current);
        for (const chapter of dangling?.chapters || []) {
          if (chapter.mangaId === id) {
            next.delete(chapter.id);
          }
        }
        return next;
      });
    }
  }
  function toggleDanglingChapter(id: string, selected: boolean) {
    setSelectedDanglingChapters((current) => {
      const next = new Set(current);
      selected ? next.add(id) : next.delete(id);
      return next;
    });
  }
  function toggleAllDangling() {
    if (!dangling || allDanglingSelected) {
      setSelectedDanglingManga(new Set());
      setSelectedDanglingChapters(new Set());
      return;
    }
    const mangaIds = new Set(dangling.manga.map((manga) => manga.id));
    setSelectedDanglingManga(mangaIds);
    setSelectedDanglingChapters(
      new Set(
        dangling.chapters
          .filter((chapter) => !mangaIds.has(chapter.mangaId))
          .map((chapter) => chapter.id),
      ),
    );
  }
  return (
    <>
      <Link className="back-link" to="/settings">
        <ArrowLeft size={17} />
        返回设置
      </Link>
      <section className="page-heading">
        <div>
          <h1>系统管理</h1>
        </div>
      </section>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="settings-layout">
        <section className="panel app-settings-panel">
          <div className="panel-heading">
            <div>
              <h2>应用设置</h2>
              <p>自定义浏览器标题与 PWA 应用名</p>
            </div>
          </div>
          <form
            className="account-form app-name-form"
            onSubmit={(event) => {
              event.preventDefault();
              setNameError("");
              setNameSaved(false);
              setSavingName(true);
              void api<AppConfig>(
                "/system-settings",
                json("PUT", { appName: name }),
              )
                .then((config) => {
                  setName(config.appName);
                  onAppNameChanged(config.appName);
                  setNameSaved(true);
                })
                .catch((error: Error) => setNameError(error.message))
                .finally(() => setSavingName(false));
            }}
          >
            <label>
              应用名称
              <span className="app-name-control">
                <input
                  value={name}
                  required
                  maxLength={50}
                  onChange={(event) => {
                    setName(event.target.value);
                    setNameSaved(false);
                  }}
                />
                <button
                  className="primary"
                  disabled={
                    savingName || !name.trim() || name.trim() === appName
                  }
                >
                  {savingName ? "保存中…" : "保存"}
                </button>
              </span>
            </label>
            <p className="hint">
              已安装的 PWA 可能需要重新添加到主屏幕才能更新名称。
            </p>
            {nameError && (
              <p className="error" role="alert">
                {nameError}
              </p>
            )}
            {nameSaved && (
              <p className="hint app-name-status" role="status">
                应用名称已保存
              </p>
            )}
          </form>
        </section>
        <UserManagement users={users} onChanged={load} />
        <section className="panel storage-panel">
          <div className="panel-heading">
            <div>
              <h2>空间占用</h2>
              <p>分析处理图片，并清理由旧版本或失败任务留下的文件</p>
            </div>
            <button
              className="soft-button"
              disabled={storageLoading || cleaning || active}
              onClick={() => void loadStorage()}
            >
              <RefreshCw size={16} />
              {storageLoading ? "分析中…" : "重新分析"}
            </button>
          </div>
          {!storage && storageLoading && (
            <div className="storage-loading" role="status">
              <HardDrive size={26} />
              正在扫描处理图片…
            </div>
          )}
          {storageError && (
            <p className="error" role="alert">
              {storageError}
            </p>
          )}
          {storage && (
            <>
              <div className="storage-summary">
                <div>
                  <span>处理目录</span>
                  <strong>{formatBytes(storage.total.bytes)}</strong>
                  <small>{storage.total.files.toLocaleString()} 个文件</small>
                </div>
                <div>
                  <span>正在使用</span>
                  <strong>{formatBytes(storage.used.bytes)}</strong>
                  <small>{storage.used.files.toLocaleString()} 个文件</small>
                </div>
                <div className="reclaimable">
                  <span>可以清理</span>
                  <strong>{formatBytes(storage.reclaimable.bytes)}</strong>
                  <small>
                    旧记录 {formatBytes(storage.databaseStale.bytes)} · 孤儿文件{" "}
                    {formatBytes(storage.orphaned.bytes)}
                  </small>
                </div>
              </div>
              <div className="storage-breakdown">
                <div className="storage-breakdown-heading">
                  <span>文件类型</span>
                  <span>图片数量</span>
                  <span>使用中</span>
                  <span>可清理</span>
                </div>
                {storageKinds.map(([kind, label]) => (
                  <div key={kind}>
                    <span>{label}</span>
                    <span>
                      {(
                        storage.kinds[kind].used.files +
                        storage.kinds[kind].reclaimable.files
                      ).toLocaleString()}
                    </span>
                    <span>{formatBytes(storage.kinds[kind].used.bytes)}</span>
                    <span>
                      {formatBytes(storage.kinds[kind].reclaimable.bytes)}
                    </span>
                  </div>
                ))}
              </div>
              {storage.missingFiles > 0 && (
                <p className="error" role="alert">
                  有 {storage.missingFiles.toLocaleString()}{" "}
                  个当前图片文件缺失，建议先刷新全部。
                </p>
              )}
              {cleanupResult && (
                <p className="storage-cleaned" role="status">
                  已删除 {cleanupResult.files.toLocaleString()} 个无用文件，释放{" "}
                  {formatBytes(cleanupResult.bytes)}。
                </p>
              )}
              <div className="storage-actions">
                <p className="hint">
                  清理只会删除当前章节、封面和预览不再引用的处理文件，不会修改原始漫画目录。
                </p>
                <button
                  className="danger-button"
                  disabled={
                    cleaning ||
                    active ||
                    storage.reclaimable.files === 0 ||
                    storage.missingFiles > 0
                  }
                  onClick={() => setCleanupOpen(true)}
                >
                  <Trash2 size={16} />
                  清理无用图片
                </button>
              </div>
            </>
          )}
        </section>
        <section className="panel dangling-panel">
          <div className="panel-heading">
            <div>
              <h2>悬垂内容</h2>
              <p>查找挂载目录中已不存在或不再有效的漫画与章节记录</p>
            </div>
            <button
              className="soft-button"
              disabled={danglingLoading || deletingDangling || active}
              onClick={() => void loadDangling()}
            >
              <RefreshCw size={16} />
              {danglingLoading ? "扫描中…" : "重新扫描"}
            </button>
          </div>
          {!dangling && danglingLoading && (
            <div className="storage-loading" role="status">
              <Unlink size={26} />
              正在核对漫画和章节目录…
            </div>
          )}
          {danglingError && (
            <p className="error" role="alert">
              {danglingError}
            </p>
          )}
          {dangling &&
            dangling.manga.length === 0 &&
            dangling.chapters.length === 0 && (
              <div className="dangling-empty" role="status">
                <Unlink size={24} />
                <div>
                  <strong>没有发现悬垂内容</strong>
                  <small>现有漫画和章节记录均能在挂载目录中找到。</small>
                </div>
              </div>
            )}
          {dangling &&
            (dangling.manga.length > 0 || dangling.chapters.length > 0) && (
              <>
                <div className="dangling-summary">
                  <p>
                    发现 <strong>{dangling.manga.length}</strong> 部漫画、
                    <strong>{dangling.chapters.length}</strong> 个章节
                  </p>
                  <button className="soft-button" onClick={toggleAllDangling}>
                    {allDanglingSelected ? "取消全选" : "全选"}
                  </button>
                </div>
                <div className="dangling-list">
                  {dangling.manga.length > 0 && (
                    <div className="dangling-group">
                      <h3>悬垂漫画</h3>
                      {dangling.manga.map((manga) => (
                        <label className="dangling-row" key={manga.id}>
                          <input
                            type="checkbox"
                            checked={selectedDanglingManga.has(manga.id)}
                            onChange={(event) =>
                              toggleDanglingManga(
                                manga.id,
                                event.target.checked,
                              )
                            }
                          />
                          <span>
                            <strong>{manga.title}</strong>
                            <code>{manga.path}</code>
                            <small>
                              {manga.chapterCount.toLocaleString()} 个章节
                            </small>
                          </span>
                          <em>{danglingReasons[manga.reason]}</em>
                        </label>
                      ))}
                    </div>
                  )}
                  {dangling.chapters.length > 0 && (
                    <div className="dangling-group">
                      <h3>悬垂章节</h3>
                      {dangling.chapters.map((chapter) => {
                        const includedByManga = selectedDanglingManga.has(
                          chapter.mangaId,
                        );
                        return (
                          <label className="dangling-row" key={chapter.id}>
                            <input
                              type="checkbox"
                              checked={
                                includedByManga ||
                                selectedDanglingChapters.has(chapter.id)
                              }
                              disabled={includedByManga}
                              onChange={(event) =>
                                toggleDanglingChapter(
                                  chapter.id,
                                  event.target.checked,
                                )
                              }
                            />
                            <span>
                              <strong>
                                {chapter.mangaTitle} / {chapter.title}
                              </strong>
                              <code>{chapter.path}</code>
                              <small>
                                {includedByManga
                                  ? "将随漫画一起删除"
                                  : `${chapter.pageCount.toLocaleString()} 页`}
                              </small>
                            </span>
                            <em>{danglingReasons[chapter.reason]}</em>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
                {danglingDeleted && (
                  <p className="storage-cleaned" role="status">
                    已删除 {danglingDeleted.manga} 部悬垂漫画和{" "}
                    {danglingDeleted.chapters} 个悬垂章节。
                  </p>
                )}
                <div className="dangling-actions">
                  <p className="hint">
                    删除只会移除平台记录和对应处理图片，不会修改原始漫画目录。
                  </p>
                  <button
                    className="danger-button"
                    disabled={
                      danglingSelectionCount === 0 || deletingDangling || active
                    }
                    onClick={() => setDanglingDeleteOpen(true)}
                  >
                    <Trash2 size={16} />
                    删除所选
                    {danglingSelectionCount
                      ? `（${danglingSelectionCount}）`
                      : ""}
                  </button>
                </div>
              </>
            )}
        </section>
        <section className="panel sources-panel">
          <div className="panel-heading">
            <div>
              <h2>漫画导入</h2>
              <p>从本地目录导入，手动刷新获取新章节</p>
            </div>
            <button className="primary" onClick={() => openSource(null)}>
              <Plus size={18} />
              添加目录
            </button>
          </div>
          {sources.length === 0 ? (
            <div className="empty compact">
              <Folder size={32} />
              <h3>还没有导入目录</h3>
              <p>添加一个目录，开始建立你的书架。</p>
            </div>
          ) : (
            sources.map((s) => (
              <div className="source-row" key={s.id}>
                <span className="folder-icon">
                  <Folder size={22} />
                </span>
                <div className="source-info">
                  <strong>
                    {s.path}
                    <span className="tag">{modes[s.mode]}</span>
                  </strong>
                  <small className="source-metrics">
                    {s.stats_updated
                      ? `${s.image_count.toLocaleString()} 张图片 · ${formatBytes(s.image_bytes)}`
                      : "正在统计图片数量与大小…"}
                    {" · 上次刷新："}
                    {s.last_scan
                      ? new Date(s.last_scan).toLocaleString("zh-CN")
                      : "尚未刷新"}
                  </small>
                  {jobs
                    .filter(
                      (job) =>
                        job.source_id === s.id && job.status === "running",
                    )
                    .map((job) => (
                      <div key={job.id}>
                        <small>
                          {job.message} · {job.done} / {job.total}
                        </small>
                        <progress
                          aria-label="目录图片处理进度"
                          value={job.done}
                          max={job.total || 1}
                        />
                      </div>
                    ))}
                </div>
                <button
                  className="soft-button"
                  disabled={active || busy}
                  onClick={() => setRefreshSource(s)}
                >
                  <RefreshCw size={16} />
                  刷新
                </button>
                <button
                  className="icon"
                  aria-label={`目录设置 ${s.path}`}
                  disabled={active || busy}
                  onClick={() => openSource(s)}
                >
                  <Settings2 size={17} />
                </button>
              </div>
            ))
          )}
          {jobs
            .filter(
              (j) => j.status === "running" || observedJobs.current.has(j.id),
            )
            .slice(0, 3)
            .map((j) => {
              const estimate = jobEstimate(j);
              return (
                <div className={`job ${j.status}`} key={j.id}>
                  <div>
                    <strong>
                      {j.status === "running"
                        ? j.total > 0
                          ? "正在处理图片"
                          : "正在扫描目录"
                        : j.status === "failed"
                          ? "导入未完成"
                          : "导入完成"}
                    </strong>
                    <span>
                      {estimate.percent}% · {j.done} / {j.total}
                    </span>
                  </div>
                  <progress
                    aria-label={`图片处理进度 ${estimate.percent}%`}
                    value={j.done}
                    max={j.total || 1}
                  />
                  <p>{j.error || j.message}</p>
                  {estimate.remaining && (
                    <small className="job-estimate">{estimate.remaining}</small>
                  )}
                </div>
              );
            })}
          <p className="hint">
            刷新保留手动修改的信息；移除导入源时可选择是否清理平台漫画，素材始终保留。
          </p>
        </section>
      </div>
      {refreshSource && (
        <Sheet title="刷新目录" onClose={() => setRefreshSource(null)}>
          <div className="refresh-options">
            {(
              [
                ["new", "仅刷新新增", "只导入新漫画、新章节，跳过已有章节"],
                ["all", "刷新全部", "检查全部章节，复用未变化图片"],
              ] as const
            ).map(([mode, title, description]) => (
              <button
                key={mode}
                disabled={busy || active}
                onClick={() =>
                  perform(async () => {
                    await refresh(refreshSource.id, mode);
                    setRefreshSource(null);
                  })
                }
              >
                <strong>{title}</strong>
                <span>{description}</span>
              </button>
            ))}
          </div>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </Sheet>
      )}
      {adding && (
        <Sheet
          title={editingSource ? "目录设置" : "添加漫画目录"}
          onClose={() => setAdding(false)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void perform(async () => {
                if (editingSource) {
                  await api(
                    `/sources/${editingSource.id}`,
                    json("PATCH", { path, mode, userIds }),
                  );
                } else {
                  const source = await api<Source>(
                    "/sources",
                    json("POST", { path, mode, userIds }),
                  );
                  await refresh(source.id);
                }
                setAdding(false);
                setPath("");
              });
            }}
          >
            <label>
              导入方式
              <select value={mode} onChange={(e) => setMode(e.target.value)}>
                <option value="manual">完全手动 · 此目录就是一部漫画</option>
                <option value="one">一层扫描 · 子目录分别作为漫画</option>
                <option value="two">二层扫描 · 第一层作者，第二层漫画</option>
              </select>
            </label>
            <label>
              目录路径
              <div className="inline">
                <input
                  required
                  placeholder="相对于素材目录的路径，或完整路径"
                  value={path}
                  onChange={(e) => setPath(e.target.value)}
                />
                <button
                  type="button"
                  className="soft-button"
                  onClick={() => browse(path || ".")}
                >
                  <Folder size={18} />
                  浏览
                </button>
              </div>
            </label>
            <p className="hint">目录名称用于漫画及章节标题。</p>
            {browser && (
              <div className="directory-browser">
                <div>
                  <button
                    type="button"
                    className="icon"
                    aria-label="上级目录"
                    disabled={browser.path === browser.root}
                    onClick={() => browse(browser.path + "/..")}
                  >
                    <ArrowLeft size={18} />
                  </button>
                  <code>{browser.path}</code>
                </div>
                {browser.directories.map((d) => (
                  <button type="button" key={d} onClick={() => browse(d)}>
                    <Folder size={17} />
                    {d.split("/").pop()}
                    <ChevronRight size={17} />
                  </button>
                ))}
                {!browser.directories.length && (
                  <p className="muted">此目录没有子文件夹</p>
                )}
                <button
                  type="button"
                  className="primary"
                  onClick={() => {
                    setPath(browser.path);
                    setBrowser(null);
                  }}
                >
                  选择此目录
                </button>
              </div>
            )}
            {error && <p className="error">{error}</p>}
            <fieldset className="visibility-picker">
              <legend>可见用户</legend>
              {users.map((account) => (
                <label key={account.id}>
                  <input
                    type="checkbox"
                    checked={userIds.includes(account.id)}
                    onChange={(event) =>
                      setUserIds(
                        event.target.checked
                          ? [...userIds, account.id]
                          : userIds.filter((id) => id !== account.id),
                      )
                    }
                  />
                  <span>
                    {account.email}
                    {account.isAdmin && <small>管理员</small>}
                  </span>
                </label>
              ))}
              {userIds.length === 0 && (
                <p className="hint">未选择用户，此目录漫画对所有人隐藏。</p>
              )}
            </fieldset>
            <button className="primary full" disabled={busy || active}>
              {editingSource ? "保存设置" : "添加并导入"}
            </button>
          </form>
          {editingSource && (
            <>
              <button
                className="danger-button full"
                disabled={busy || active}
                onClick={() => {
                  setError("");
                  setDeletingSource(editingSource);
                }}
              >
                <Trash2 size={16} />
                移除导入目录
              </button>
              <p className="hint">
                移除时可以选择是否一并删除平台中的漫画，原始文件始终保留。
              </p>
              <h3 className="history-title">最近导入记录</h3>
              {history.length === 0 ? (
                <p className="muted">暂无导入记录</p>
              ) : (
                history.map((j) => (
                  <div className={`job ${j.status}`} key={j.id}>
                    <div>
                      <strong>
                        {j.status === "completed"
                          ? "导入完成"
                          : j.status === "failed"
                            ? "导入失败"
                            : "正在导入"}
                      </strong>
                      <small>{j.created}</small>
                    </div>
                    <p>{j.error || j.message}</p>
                  </div>
                ))
              )}
            </>
          )}
        </Sheet>
      )}
      {deletingSource && (
        <Sheet title="移除导入目录" onClose={() => setDeletingSource(null)}>
          <p>
            请选择如何处理“
            {deletingSource.path === "."
              ? "素材根目录"
              : deletingSource.path.split("/").pop() || deletingSource.path}
            ”。以下操作都不会删除目录中的原始漫画文件。
          </p>
          <div className="refresh-options source-delete-options">
            <button
              disabled={busy || active}
              onClick={() =>
                void perform(async () => {
                  await api(`/sources/${deletingSource.id}`, {
                    method: "DELETE",
                  });
                  setDeletingSource(null);
                  setAdding(false);
                  setEditingSource(null);
                })
              }
            >
              <strong>仅移除导入源</strong>
              <span>保留书架中的漫画及处理图片，停止从此目录刷新。</span>
            </button>
            <button
              className="danger-option"
              disabled={busy || active}
              onClick={() =>
                void perform(async () => {
                  await api(
                    `/sources/${deletingSource.id}`,
                    json("DELETE", { deleteManga: true }),
                  );
                  setDeletingSource(null);
                  setAdding(false);
                  setEditingSource(null);
                })
              }
            >
              <strong>移除导入源并删除漫画</strong>
              <span>
                删除仅由此源导入的漫画记录与处理图片；同时关联其他源的漫画会保留。
              </span>
            </button>
          </div>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button
            className="soft-button full source-delete-cancel"
            disabled={busy}
            onClick={() => setDeletingSource(null)}
          >
            取消
          </button>
        </Sheet>
      )}
      {danglingDeleteOpen && dangling && (
        <Sheet
          title="删除悬垂内容"
          onClose={() => setDanglingDeleteOpen(false)}
        >
          <p>
            将删除 {selectedDanglingManga.size} 部漫画和{" "}
            {independentlySelectedChapters.length}{" "}
            个独立章节的平台记录及处理图片。
          </p>
          <p className="hint">
            选择整部漫画时，其章节会一并删除。挂载目录中的原始文件不会被修改；删除前系统会重新确认这些内容仍处于悬垂状态。
          </p>
          {danglingError && (
            <p className="error" role="alert">
              {danglingError}
            </p>
          )}
          <div className="confirm-actions">
            <button
              className="soft-button"
              disabled={deletingDangling}
              onClick={() => setDanglingDeleteOpen(false)}
            >
              取消
            </button>
            <button
              className="danger-button"
              disabled={
                deletingDangling || active || danglingSelectionCount === 0
              }
              onClick={() => {
                setDeletingDangling(true);
                setDanglingError("");
                void api<DanglingDeleteResult>(
                  "/dangling",
                  json("DELETE", {
                    mangaIds: [...selectedDanglingManga],
                    chapterIds: independentlySelectedChapters,
                  }),
                )
                  .then((result) => {
                    setDangling(result.analysis);
                    setDanglingDeleted({
                      manga: result.deletedManga,
                      chapters: result.deletedChapters,
                    });
                    setSelectedDanglingManga(new Set());
                    setSelectedDanglingChapters(new Set());
                    setDanglingDeleteOpen(false);
                    void loadStorage();
                  })
                  .catch((error: Error) => setDanglingError(error.message))
                  .finally(() => setDeletingDangling(false));
              }}
            >
              <Trash2 size={16} />
              {deletingDangling ? "删除中…" : "确认删除"}
            </button>
          </div>
        </Sheet>
      )}
      {cleanupOpen && storage && (
        <Sheet title="清理无用图片" onClose={() => setCleanupOpen(false)}>
          <p>
            将删除 {storage.reclaimable.files.toLocaleString()}{" "}
            个当前已不再使用的处理文件，预计释放{" "}
            <strong>{formatBytes(storage.reclaimable.bytes)}</strong>。
          </p>
          <p className="hint">
            当前章节图片、已选择封面和原始漫画文件都会保留。清理开始后请等待完成。
          </p>
          {storageError && (
            <p className="error" role="alert">
              {storageError}
            </p>
          )}
          <div className="confirm-actions">
            <button
              className="soft-button"
              disabled={cleaning}
              onClick={() => setCleanupOpen(false)}
            >
              取消
            </button>
            <button
              className="danger-button"
              disabled={cleaning || active}
              onClick={() => {
                setCleaning(true);
                setStorageError("");
                void api<StorageCleanupResult>(
                  "/storage/cleanup",
                  json("POST", {}),
                )
                  .then((result) => {
                    setStorage(result.analysis);
                    setCleanupResult(result.deleted);
                    setCleanupOpen(false);
                  })
                  .catch((error: Error) => setStorageError(error.message))
                  .finally(() => setCleaning(false));
              }}
            >
              <Trash2 size={16} />
              {cleaning ? "清理中…" : "确认清理"}
            </button>
          </div>
        </Sheet>
      )}
    </>
  );
}
