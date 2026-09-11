import { useEffect, useState, useRef } from "react";
import {
  Folder,
  RefreshCw,
  Plus,
  ChevronRight,
  ArrowLeft,
  Trash2,
  Settings2,
} from "lucide-react";
import { api, json } from "../api";
import type { Source, Job } from "../types";
import { useAccount } from "../account";
import { UserManagement } from "../components/UserManagement";
import { Link } from "react-router-dom";
import type { User } from "../types";
import { Sheet } from "../components/Sheet";

const modes: Record<string, string> = {
  manual: "指定漫画",
  one: "一层扫描",
  two: "二层扫描",
};

export function SystemSettings() {
  const { user } = useAccount();
  const [users, setUsers] = useState<User[]>([]);
  const [userIds, setUserIds] = useState<string[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [error, setError] = useState("");
  const [refreshSource, setRefreshSource] = useState<Source | null>(null);
  const [adding, setAdding] = useState(false);
  const [editingSource, setEditingSource] = useState<Source | null>(null);
  const [history, setHistory] = useState<Job[]>([]);
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
  useEffect(() => {
    void load();
    const timer = setInterval(load, 1500);
    return () => clearInterval(timer);
  }, []);
  const active = jobs.some((j) => j.status === "running");
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
  return (
    <>
      <Link className="back-link" to="/settings">
        <ArrowLeft size={17} />
        返回设置
      </Link>
      <section className="page-heading">
        <div>
          <h1>系统设置</h1>
        </div>
      </section>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="settings-layout">
        <UserManagement users={users} onChanged={load} />
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
                    {s.path === "."
                      ? "素材根目录"
                      : s.path.split("/").pop() || s.path}
                    <span className="tag">{modes[s.mode]}</span>
                  </strong>
                  <code>{s.path}</code>
                  <small>
                    上次刷新：
                    {s.last_scan
                      ? new Date(s.last_scan).toLocaleString("zh-CN")
                      : "尚未刷新"}
                  </small>
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
            .map((j) => (
              <div className={`job ${j.status}`} key={j.id}>
                <div>
                  <strong>
                    {j.status === "running"
                      ? "正在处理图片"
                      : j.status === "failed"
                        ? "导入未完成"
                        : "导入完成"}
                  </strong>
                  <span>
                    {j.done} / {j.total}
                  </span>
                </div>
                <progress
                  aria-label="图片处理进度"
                  value={j.done}
                  max={j.total || 1}
                />
                <p>{j.error || j.message}</p>
              </div>
            ))}
          <p className="hint">
            刷新保留手动修改的信息。移除导入源不会删除漫画或素材。
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
                <option value="two">二层扫描 · 第一层标签，第二层漫画</option>
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
                onClick={() =>
                  perform(async () => {
                    await api(`/sources/${editingSource.id}`, {
                      method: "DELETE",
                    });
                    setAdding(false);
                  })
                }
              >
                <Trash2 size={16} />
                移除导入目录
              </button>
              <p className="hint">
                移除目录保留已导入漫画。修改设置后，下次刷新按新设置扫描。
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
    </>
  );
}
