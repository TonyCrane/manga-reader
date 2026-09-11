import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  BookOpen,
  Check,
  ListChecks,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { useAccount } from "../account";
import { TagInput } from "../components/TagInput";
import { parseTimestamp } from "../dates";
import { SearchFilter } from "../components/SearchFilter";
import { api } from "../api";
import type { Manga } from "../types";
import { Sheet } from "../components/Sheet";

const maxBatchSize = 500;

type DeleteProgress = {
  completed: number;
  total: number;
  title: string;
};

function LibraryCard({
  manga,
  selecting,
  selected,
  onSelect,
}: {
  manga: Manga;
  selecting: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  const content = (
    <>
      <div className="cover">
        <img
          src={`/api/manga/${manga.id}/cover?size=small`}
          alt={`${manga.title} 封面`}
          loading="lazy"
          decoding="async"
        />
        {selecting ? (
          <span className="cover-select" aria-hidden="true">
            {selected && <Check size={17} strokeWidth={3} />}
          </span>
        ) : (
          <span className="cover-open">
            <BookOpen size={20} />
            打开漫画
          </span>
        )}
      </div>
      <h3>{manga.title}</h3>
      <p>
        {manga.chapterCount} 话<span> · </span>
        {manga.author || "作者未填写"}
      </p>
      {manga.tags.length > 0 && (
        <div className="card-tags">
          {manga.tags.slice(0, 3).map((tag) => (
            <span key={tag}>{tag}</span>
          ))}
        </div>
      )}
    </>
  );
  if (selecting) {
    return (
      <button
        type="button"
        className={`manga-card manga-select${selected ? " selected" : ""}`}
        aria-pressed={selected}
        aria-label={`${selected ? "取消选择" : "选择"}${manga.title}`}
        onClick={onSelect}
      >
        {content}
      </button>
    );
  }
  return (
    <Link className="manga-card" to={`/manga/${manga.id}`}>
      {content}
    </Link>
  );
}

export function Library() {
  const { user } = useAccount();
  const [searchParams, setSearchParams] = useSearchParams();
  const [manga, setManga] = useState<Manga[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [ascending, setAscending] = useState(true);
  const [sort, setSort] = useState("title");
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteProgress, setDeleteProgress] = useState<DeleteProgress | null>(
    null,
  );
  const requestedTags = useMemo(
    () => searchParams.getAll("tag"),
    [searchParams],
  );
  const requestedAuthor = searchParams.get("author") || "";
  useEffect(() => {
    api<Manga[]>("/manga")
      .then(setManga)
      .catch((e) => setError(e.message))
      .finally(() => setLoaded(true));
  }, []);
  const { authors, tags } = useMemo(
    () => ({
      authors: [...new Set(manga.map((item) => item.author).filter(Boolean))],
      tags: [...new Set(manga.flatMap((item) => item.tags))],
    }),
    [manga],
  );
  const selectedTags = useMemo(
    () => [...new Set(requestedTags.filter((tag) => tags.includes(tag)))],
    [requestedTags, tags],
  );
  const author = authors.includes(requestedAuthor) ? requestedAuthor : "";
  const filtered = useMemo(
    () =>
      manga
        .filter(
          (m) =>
            (!search || m.title.toLowerCase().includes(search.toLowerCase())) &&
            (!author || m.author === author) &&
            selectedTags.every((tag) => m.tags.includes(tag)),
        )
        .sort((a, b) => {
          const direction = ascending ? 1 : -1;
          if (sort === "count") {
            return (
              direction * (a.chapterCount - b.chapterCount) ||
              a.title.localeCompare(b.title)
            );
          }
          if (sort === "created") {
            return (
              direction *
                (parseTimestamp(a.created) - parseTimestamp(b.created)) ||
              a.title.localeCompare(b.title)
            );
          }
          if (sort === "published") {
            if (!a.published) {
              return b.published ? 1 : 0;
            }
            if (!b.published) {
              return -1;
            }
            return (
              direction * a.published.localeCompare(b.published) ||
              a.title.localeCompare(b.title)
            );
          }
          return direction * a.title.localeCompare(b.title);
        }),
    [manga, search, author, selectedTags, sort, ascending],
  );
  const allFilteredSelected =
    filtered.length > 0 && filtered.every((item) => selectedIds.has(item.id));

  function changeSelectedTags(value: string[]) {
    const next = new URLSearchParams(searchParams);
    next.delete("tag");
    for (const tag of value) {
      next.append("tag", tag);
    }
    setSearchParams(next, { replace: true });
  }

  function changeAuthor(value: string) {
    const next = new URLSearchParams(searchParams);
    if (value) {
      next.set("author", value);
    } else {
      next.delete("author");
    }
    setSearchParams(next, { replace: true });
  }

  function toggleSelected(id: string) {
    if (!selectedIds.has(id) && selectedIds.size >= maxBatchSize) {
      setError(`一次最多选择 ${maxBatchSize} 部漫画`);
      return;
    }
    setError("");
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function toggleAllFiltered() {
    const next = new Set(selectedIds);
    if (allFilteredSelected) {
      for (const item of filtered) {
        next.delete(item.id);
      }
      setError("");
    } else {
      for (const item of filtered) {
        if (!next.has(item.id) && next.size < maxBatchSize) {
          next.add(item.id);
        }
      }
      setError(
        filtered.some((item) => !next.has(item.id))
          ? `一次最多选择 ${maxBatchSize} 部漫画`
          : "",
      );
    }
    setSelectedIds(next);
  }

  function finishSelecting() {
    setSelecting(false);
    setSelectedIds(new Set());
  }

  async function deleteSelected() {
    const ids = [...selectedIds];
    const titles = new Map(manga.map((item) => [item.id, item.title]));
    let completed = 0;
    setDeleting(true);
    setError("");
    setDeleteProgress({ completed, total: ids.length, title: "" });
    try {
      for (const id of ids) {
        const title = titles.get(id) || id;
        setDeleteProgress({ completed, total: ids.length, title });
        await api(`/manga/${id}`, { method: "DELETE" });
        completed++;
        setDeleteProgress({ completed, total: ids.length, title });
        setManga((current) => current.filter((item) => item.id !== id));
        setSelectedIds((current) => {
          const next = new Set(current);
          next.delete(id);
          return next;
        });
      }
      setConfirmDelete(false);
      finishSelecting();
    } catch (deleteError) {
      setError(
        `已删除 ${completed} / ${ids.length} 部；${(deleteError as Error).message}`,
      );
    } finally {
      setDeleting(false);
    }
  }

  function closeDeleteSheet() {
    if (!deleting) {
      setConfirmDelete(false);
    }
  }

  return (
    <>
      <section className="page-heading">
        <div>
          <h1>
            我的书架<span className="count">{manga.length}</span>
          </h1>
        </div>
        {user.isAdmin && (
          <div className="page-actions">
            <button
              className="soft-button"
              aria-pressed={selecting}
              onClick={() => {
                if (selecting) {
                  finishSelecting();
                } else {
                  setSelecting(true);
                }
              }}
            >
              <ListChecks size={17} />
              {selecting ? "完成" : "批量管理"}
            </button>
            <Link className="soft-button" to="/settings/system">
              管理导入
              <ArrowUpRight size={17} />
            </Link>
          </div>
        )}
      </section>
      <div className="library-toolbar">
        <div className="input-icon search">
          <Search size={19} />
          <input
            aria-label="搜索漫画"
            placeholder="搜索漫画名称"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button
              className="icon"
              aria-label="清除搜索"
              onClick={() => setSearch("")}
            >
              <X size={16} />
            </button>
          )}
        </div>
        <div className="filters">
          <TagInput
            label="筛选标签"
            placeholder="筛选标签"
            options={tags}
            value={selectedTags}
            onChange={changeSelectedTags}
          />
          <SearchFilter
            label="作者"
            options={authors}
            value={author}
            onChange={changeAuthor}
          />
        </div>
      </div>
      <div className="section-title">
        <span>
          全部漫画 <small>{filtered.length} 部作品</small>
        </span>
        <div className="sort-controls">
          <select
            aria-label="排序"
            value={sort}
            onChange={(e) => setSort(e.target.value)}
          >
            <option value="title">名称排序</option>
            <option value="count">话数排序</option>
            <option value="created">导入时间</option>
            <option value="published">发布时间</option>
          </select>
          <button
            className="icon"
            aria-label={ascending ? "升序，切换为降序" : "降序，切换为升序"}
            title={ascending ? "升序" : "降序"}
            onClick={() => setAscending((value) => !value)}
          >
            {ascending ? <ArrowUp size={18} /> : <ArrowDown size={18} />}
          </button>
        </div>
      </div>
      {selecting && (
        <div className="bulk-toolbar" role="region" aria-label="批量管理漫画">
          <span>
            已选择 <strong>{selectedIds.size}</strong> / {maxBatchSize} 部
          </span>
          <div>
            <button
              className="soft-button"
              disabled={!filtered.length}
              onClick={toggleAllFiltered}
            >
              {allFilteredSelected ? "取消当前结果" : "全选当前结果"}
            </button>
            <button
              className="danger-button"
              disabled={!selectedIds.size}
              onClick={() => {
                setError("");
                setDeleteProgress(null);
                setConfirmDelete(true);
              }}
            >
              <Trash2 size={16} />
              删除所选
            </button>
          </div>
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!loaded ? (
        <div className="loading">正在整理书架…</div>
      ) : filtered.length ? (
        <div className="manga-grid">
          {filtered.map((item) => (
            <LibraryCard
              key={item.id}
              manga={item}
              selecting={selecting}
              selected={selectedIds.has(item.id)}
              onSelect={() => toggleSelected(item.id)}
            />
          ))}
        </div>
      ) : (
        <div className="empty">
          <BookOpen size={40} />
          <h2>{manga.length ? "没有找到相关漫画" : "暂无可见漫画"}</h2>
          <p>
            {manga.length
              ? "试试其他名称、作者或标签。"
              : user.isAdmin
                ? "在系统设置中管理导入目录与可见用户。"
                : "暂无已授权的漫画。"}
          </p>
          {user.isAdmin && (
            <Link className="primary" to="/settings/system">
              管理导入
              <ArrowUpRight size={17} />
            </Link>
          )}
        </div>
      )}
      {confirmDelete && (
        <Sheet title="批量删除漫画" onClose={closeDeleteSheet}>
          <p>
            将删除所选
            {deleting && deleteProgress
              ? ` ${deleteProgress.total}`
              : ` ${selectedIds.size}`}
            部漫画的平台信息、章节、处理图片和上传封面。原始漫画目录和图片会保留。
          </p>
          <p className="hint">
            若目录仍在导入源中，后续刷新会重新导入这些漫画。
          </p>
          {deleteProgress && (
            <div className="delete-progress" role="status" aria-live="polite">
              <div>
                <span>
                  {deleting && deleteProgress.title
                    ? `正在删除：${deleteProgress.title}`
                    : "删除进度"}
                </span>
                <strong>
                  {Math.floor(
                    (deleteProgress.completed / deleteProgress.total) * 100,
                  )}
                  % · {deleteProgress.completed} / {deleteProgress.total}
                </strong>
              </div>
              <progress
                aria-label="批量删除进度"
                value={deleteProgress.completed}
                max={deleteProgress.total || 1}
              />
            </div>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="confirm-actions">
            <button
              className="soft-button"
              disabled={deleting}
              onClick={closeDeleteSheet}
            >
              取消
            </button>
            <button
              className="danger-button"
              disabled={deleting}
              onClick={() => void deleteSelected()}
            >
              {deleting
                ? "正在删除…"
                : deleteProgress && selectedIds.size > 0
                  ? `继续删除剩余 ${selectedIds.size} 部`
                  : "确认删除"}
            </button>
          </div>
        </Sheet>
      )}
    </>
  );
}
