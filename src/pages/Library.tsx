import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Search,
  ArrowUp,
  ArrowDown,
  BookOpen,
  ArrowUpRight,
  X,
} from "lucide-react";
import { useAccount } from "../account";
import { TagInput } from "../components/TagInput";
import { parseTimestamp } from "../dates";
import { SearchFilter } from "../components/SearchFilter";
import { api } from "../api";
import type { Manga } from "../types";

export function Library() {
  const { user } = useAccount();
  const [manga, setManga] = useState<Manga[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [author, setAuthor] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [ascending, setAscending] = useState(true);
  const [sort, setSort] = useState("title");
  useEffect(() => {
    api<Manga[]>("/manga")
      .then(setManga)
      .catch((e) => setError(e.message))
      .finally(() => setLoaded(true));
  }, []);
  const authors = [...new Set(manga.map((m) => m.author).filter(Boolean))];
  const tags = [...new Set(manga.flatMap((m) => m.tags))];
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

  return (
    <>
      <section className="page-heading">
        <div>
          <h1>
            我的书架<span className="count">{manga.length}</span>
          </h1>
        </div>
        {user.isAdmin && (
          <Link className="soft-button" to="/settings/system">
            管理导入
            <ArrowUpRight size={17} />
          </Link>
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
            onChange={setSelectedTags}
          />
          <SearchFilter
            label="作者"
            options={authors}
            value={author}
            onChange={setAuthor}
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
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!loaded ? (
        <div className="loading">正在整理书架…</div>
      ) : filtered.length ? (
        <div className="manga-grid">
          {filtered.map((m) => (
            <Link className="manga-card" key={m.id} to={`/manga/${m.id}`}>
              <div className="cover">
                <img
                  src={`/api/manga/${m.id}/cover`}
                  alt={`${m.title} 封面`}
                  loading="lazy"
                />
                <span className="cover-open">
                  <BookOpen size={20} />
                  打开漫画
                </span>
              </div>
              <h3>{m.title}</h3>
              <p>
                {m.chapterCount} 话<span> · </span>
                {m.author || "作者未填写"}
              </p>
              {m.tags.length > 0 && (
                <div className="card-tags">
                  {m.tags.slice(0, 3).map((t) => (
                    <span key={t}>{t}</span>
                  ))}
                </div>
              )}
            </Link>
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
    </>
  );
}
