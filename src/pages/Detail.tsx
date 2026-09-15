import { useEffect, useState } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  BookOpen,
  Pencil,
} from "lucide-react";
import { api } from "../api";
import type { Manga } from "../types";
import { useAccount } from "../account";
import { PagePreview } from "../components/PagePreview";
import { MangaEditor } from "../components/MangaEditor";

export function Detail() {
  const { id } = useParams();
  const { user } = useAccount();
  const navigate = useNavigate();
  const [m, setM] = useState<Manga | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [preview, setPreview] = useState(false);
  const [ascending, setAscending] = useState(true);
  const [version, setVersion] = useState(0);
  const load = () =>
    api<Manga>(`/manga/${id}`)
      .then(setM)
      .catch((e) => setError(e.message));
  useEffect(() => {
    void load();
  }, [id]);
  if (!m) {
    return <div className="loading">{error || "正在打开漫画…"}</div>;
  }
  const chapters = m.chapters.map((chapter, index) => ({
    chapter,
    number: index + 1,
  }));
  if (!ascending) {
    chapters.reverse();
  }
  return (
    <>
      <Link className="back-link" to="/">
        <ArrowLeft size={17} />
        返回书架
      </Link>
      <section className="detail-hero">
        <div className="detail-cover">
          <img
            src={`/api/manga/${id}/cover?size=small&v=${version}`}
            alt={m.title}
            decoding="async"
          />
        </div>
        <div className="detail-info">
          <h1>{m.title}</h1>
          {m.title_zh && <p className="secondary-title">{m.title_zh}</p>}
          <p className="muted">
            {m.author ? (
              <Link
                className="author-link"
                to={`/?author=${encodeURIComponent(m.author)}`}
                aria-label={`在书架中筛选作者 ${m.author}`}
              >
                {m.author}
              </Link>
            ) : (
              "作者未填写"
            )}
            <span className="dot">·</span>
            {m.chapterCount} 话<span className="dot">·</span>
            {m.pageCount} 页
          </p>
          <p className="muted">
            {m.published ? `发布时间 ${m.published}` : "发布时间未填写"}
          </p>
          <div className="tags">
            {m.tags.map((tag) => (
              <Link
                className="tag tag-link"
                key={tag}
                to={`/?tag=${encodeURIComponent(tag)}`}
                aria-label={`在书架中筛选标签 ${tag}`}
              >
                {tag}
              </Link>
            ))}
          </div>
          <div className="detail-actions">
            {m.chapters[0] && (
              <Link className="primary" to={`/read/${id}/${m.chapters[0].id}`}>
                <BookOpen size={18} />
                开始阅读
                <ArrowRight size={17} />
              </Link>
            )}
            {user.isAdmin && (
              <button className="soft-button" onClick={() => setEditing(true)}>
                <Pencil size={16} />
                编辑信息
              </button>
            )}
          </div>
        </div>
      </section>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <section className="chapter-section">
        <div className="section-title">
          <div
            className="detail-view-toggle"
            role="group"
            aria-label="目录显示方式"
          >
            <button aria-pressed={!preview} onClick={() => setPreview(false)}>
              章节目录
            </button>
            <button aria-pressed={preview} onClick={() => setPreview(true)}>
              页面预览
            </button>
          </div>
          <button
            className="chapter-order"
            aria-label={ascending ? "正序，切换为倒序" : "倒序，切换为正序"}
            title={ascending ? "切换为倒序" : "切换为正序"}
            onClick={() => setAscending((value) => !value)}
          >
            {ascending ? <ArrowUp size={16} /> : <ArrowDown size={16} />}
            {ascending ? "正序" : "倒序"}
          </button>
        </div>
        {preview ? (
          <PagePreview
            key={`${id}-${ascending}`}
            mangaId={m.id}
            chapters={chapters}
          />
        ) : (
          <div className="chapter-grid">
            {chapters.map(({ chapter, number }) => (
              <Link
                key={chapter.id}
                to={`/read/${id}/${chapter.id}`}
                className="chapter-card"
              >
                <span className="chapter-number">
                  {String(number).padStart(2, "0")}
                </span>
                <div>
                  <strong>{chapter.title}</strong>
                  <small>{chapter.pages.length} 页</small>
                </div>
                <ArrowRight size={18} />
              </Link>
            ))}
          </div>
        )}
      </section>
      {editing && (
        <MangaEditor
          m={m}
          onClose={() => setEditing(false)}
          onSaved={async () => {
            await load();
            setVersion((v) => v + 1);
          }}
          onDelete={() => navigate("/")}
        />
      )}
    </>
  );
}
