import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  BookOpen,
  Check,
  Languages,
  ListChecks,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { useAccount } from "../context/AccountContext";
import { TagInput } from "../components/TagInput";
import { parseTimestamp } from "../lib/dates";
import { SearchFilter } from "../components/SearchFilter";
import { api, json } from "../lib/api";
import { libraryRouteState } from "../lib/navigation";
import type { LibrarySort, Manga } from "../types";
import { Sheet } from "../components/Sheet";

const maxBatchSize = 500;

type DeleteProgress = {
  completed: number;
  total: number;
  title: string;
};

type LibraryBrowserState = {
  tags: string[];
  author: string;
  untagged: boolean;
  search: string;
  scrollY?: number;
};

type TitleLanguage = "ja" | "zh";

const browserStates = new Map<string, LibraryBrowserState>();

function libraryTitle(manga: Manga, language: TitleLanguage) {
  return language === "zh" && manga.title_zh ? manga.title_zh : manga.title;
}

function LibraryCard({
  manga,
  title,
  selecting,
  selected,
  priority,
  onSelect,
  onOpen,
}: {
  manga: Manga;
  title: string;
  selecting: boolean;
  selected: boolean;
  priority: boolean;
  onSelect: () => void;
  onOpen: () => void;
}) {
  const content = (
    <>
      <div className="cover">
        <img
          src={`/api/manga/${manga.id}/cover?size=small`}
          alt={`${title} 封面`}
          loading={priority ? "eager" : "lazy"}
          decoding="async"
          fetchPriority={priority ? "high" : "auto"}
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
      <h3>{title}</h3>
      <p>
        {manga.chapterCount} 话<span> · </span>
        {manga.pageCount} 页<span> · </span>
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
        aria-label={`${selected ? "取消选择" : "选择"}${title}`}
        onClick={onSelect}
      >
        {content}
      </button>
    );
  }
  return (
    <Link
      className="manga-card"
      to={`/manga/${manga.id}`}
      state={libraryRouteState}
      onClick={onOpen}
    >
      {content}
    </Link>
  );
}

export function Library() {
  const { user, setUser } = useAccount();
  const rememberedState = browserStates.get(user.id);
  const [searchParams, setSearchParams] = useSearchParams();
  const restoreScrollY = useRef(
    searchParams.has("tag") || searchParams.has("author")
      ? null
      : (rememberedState?.scrollY ?? null),
  );
  const [manga, setManga] = useState<Manga[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState(rememberedState?.search || "");
  const [selectedTags, setSelectedTags] = useState<string[]>(
    rememberedState?.tags || [],
  );
  const [author, setAuthor] = useState(rememberedState?.author || "");
  const [untagged, setUntagged] = useState(rememberedState?.untagged || false);
  const [titleLanguage, setTitleLanguage] = useState<TitleLanguage>(
    user.titleLanguage,
  );
  const [ascending, setAscending] = useState(user.libraryAscending);
  const [sort, setSort] = useState<LibrarySort>(user.librarySort);
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteProgress, setDeleteProgress] = useState<DeleteProgress | null>(
    null,
  );
  useEffect(() => {
    api<Manga[]>("/manga")
      .then(setManga)
      .catch((e) => setError(e.message))
      .finally(() => setLoaded(true));
  }, []);
  useLayoutEffect(() => {
    if (!loaded || restoreScrollY.current === null) {
      return;
    }
    const scrollY = restoreScrollY.current;
    restoreScrollY.current = null;
    window.scrollTo(0, scrollY);
    const current = browserStates.get(user.id);
    if (current?.scrollY === scrollY) {
      browserStates.set(user.id, { ...current, scrollY: undefined });
    }
  }, [loaded, user.id]);
  useEffect(() => {
    const incomingTags = [...new Set(searchParams.getAll("tag"))];
    const incomingAuthor = searchParams.get("author") || "";
    if (!incomingTags.length && !incomingAuthor) {
      return;
    }
    setSelectedTags(incomingTags);
    setAuthor(incomingAuthor);
    setUntagged(false);
    setSearch("");
    browserStates.set(user.id, {
      tags: incomingTags,
      author: incomingAuthor,
      untagged: false,
      search: "",
    });
    const next = new URLSearchParams(searchParams);
    next.delete("tag");
    next.delete("author");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams, titleLanguage, user.id]);
  const { authors, tags } = useMemo(
    () => ({
      authors: [...new Set(manga.map((item) => item.author).filter(Boolean))],
      tags: [...new Set(manga.flatMap((item) => item.tags))],
    }),
    [manga],
  );
  const filtered = useMemo(
    () =>
      manga
        .filter(
          (m) =>
            (!search ||
              m.title
                .toLocaleLowerCase()
                .includes(search.toLocaleLowerCase()) ||
              m.title_zh
                .toLocaleLowerCase()
                .includes(search.toLocaleLowerCase())) &&
            (!author || m.author === author) &&
            (!untagged || m.tags.length === 0) &&
            selectedTags.every((tag) => m.tags.includes(tag)),
        )
        .sort((a, b) => {
          const direction = ascending ? 1 : -1;
          if (sort === "count") {
            return (
              direction * (a.chapterCount - b.chapterCount) ||
              libraryTitle(a, titleLanguage).localeCompare(
                libraryTitle(b, titleLanguage),
              )
            );
          }
          if (sort === "pages") {
            return (
              direction * (a.pageCount - b.pageCount) ||
              libraryTitle(a, titleLanguage).localeCompare(
                libraryTitle(b, titleLanguage),
              )
            );
          }
          if (sort === "author") {
            if (!a.author) {
              return b.author
                ? 1
                : libraryTitle(a, titleLanguage).localeCompare(
                    libraryTitle(b, titleLanguage),
                  );
            }
            if (!b.author) {
              return -1;
            }
            return (
              direction * a.author.localeCompare(b.author) ||
              libraryTitle(a, titleLanguage).localeCompare(
                libraryTitle(b, titleLanguage),
              )
            );
          }
          if (sort === "created") {
            return (
              direction *
                (parseTimestamp(a.created) - parseTimestamp(b.created)) ||
              libraryTitle(a, titleLanguage).localeCompare(
                libraryTitle(b, titleLanguage),
              )
            );
          }
          if (sort === "updated") {
            return (
              direction *
                (parseTimestamp(a.updated) - parseTimestamp(b.updated)) ||
              libraryTitle(a, titleLanguage).localeCompare(
                libraryTitle(b, titleLanguage),
              )
            );
          }
          return (
            direction *
            libraryTitle(a, titleLanguage).localeCompare(
              libraryTitle(b, titleLanguage),
            )
          );
        }),
    [
      manga,
      search,
      author,
      untagged,
      selectedTags,
      sort,
      ascending,
      titleLanguage,
    ],
  );
  const allFilteredSelected =
    filtered.length > 0 && filtered.every((item) => selectedIds.has(item.id));

  function saveBrowserState(overrides: Partial<LibraryBrowserState> = {}) {
    browserStates.set(user.id, {
      tags: selectedTags,
      author,
      untagged,
      search,
      ...overrides,
    });
  }

  function changeSearch(value: string) {
    setSearch(value);
    saveBrowserState({ search: value });
  }

  function changeSelectedTags(value: string[]) {
    setSelectedTags(value);
    setUntagged(false);
    saveBrowserState({ tags: value, untagged: false });
  }

  function changeAuthor(value: string) {
    setAuthor(value);
    saveBrowserState({ author: value });
  }

  function toggleUntagged() {
    const next = !untagged;
    const tags = next ? [] : selectedTags;
    setUntagged(next);
    setSelectedTags(tags);
    saveBrowserState({ tags, untagged: next });
  }

  function toggleTitleLanguage() {
    const next = titleLanguage === "ja" ? "zh" : "ja";
    setTitleLanguage(next);
    setUser({ ...user, titleLanguage: next });
    void api(
      "/account/preferences",
      json("PATCH", { titleLanguage: next }),
    ).catch((saveError) => setError((saveError as Error).message));
  }

  function saveSort(nextSort: LibrarySort, nextAscending: boolean) {
    setSort(nextSort);
    setAscending(nextAscending);
    setUser({
      ...user,
      librarySort: nextSort,
      libraryAscending: nextAscending,
    });
    void api(
      "/account/preferences",
      json("PATCH", { sort: nextSort, ascending: nextAscending }),
    ).catch((saveError) => setError((saveError as Error).message));
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
    const titles = new Map(
      manga.map((item) => [item.id, libraryTitle(item, titleLanguage)]),
    );
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
            onChange={(e) => changeSearch(e.target.value)}
          />
          {search && (
            <button
              className="icon"
              aria-label="清除搜索"
              onClick={() => changeSearch("")}
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
          <button
            type="button"
            className={`untagged-filter${untagged ? " selected" : ""}`}
            aria-pressed={untagged}
            onClick={toggleUntagged}
          >
            无标签
          </button>
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
          <button
            type="button"
            className="title-language"
            title={`切换为${titleLanguage === "ja" ? "中文" : "日语"}标题`}
            aria-label={`当前显示${titleLanguage === "ja" ? "日语" : "中文"}标题，切换语言`}
            onClick={toggleTitleLanguage}
          >
            <Languages size={16} />
            <span>{titleLanguage === "ja" ? "日语" : "中文"}</span>
          </button>
          <select
            aria-label="排序"
            value={sort}
            onChange={(e) => saveSort(e.target.value as LibrarySort, ascending)}
          >
            <option value="title">名称排序</option>
            <option value="author">作者排序</option>
            <option value="count">话数排序</option>
            <option value="pages">页数排序</option>
            <option value="created">导入时间</option>
            <option value="updated">更新时间</option>
          </select>
          <button
            className="icon"
            aria-label={ascending ? "升序，切换为降序" : "降序，切换为升序"}
            title={ascending ? "升序" : "降序"}
            onClick={() => saveSort(sort, !ascending)}
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
          {filtered.map((item, index) => (
            <LibraryCard
              key={item.id}
              manga={item}
              title={libraryTitle(item, titleLanguage)}
              selecting={selecting}
              selected={selectedIds.has(item.id)}
              priority={index < 6}
              onSelect={() => toggleSelected(item.id)}
              onOpen={() => saveBrowserState({ scrollY: window.scrollY })}
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
