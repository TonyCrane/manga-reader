import { useEffect, useState } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowRight, BookOpen, Pencil } from "lucide-react";
import { api } from "../api";
import type { Manga } from "../types";
import { useAccount } from "../account";
import { MangaEditor } from "../components/MangaEditor";

export function Detail() {
  const { id } = useParams();
  const { user } = useAccount();
  const navigate = useNavigate();
  const [m, setM] = useState<Manga | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
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
  return (
    <>
      <Link className="back-link" to="/">
        <ArrowLeft size={17} />
        返回书架
      </Link>
      <section className="detail-hero">
        <div className="detail-cover">
          <img src={`/api/manga/${id}/cover?v=${version}`} alt={m.title} />
        </div>
        <div className="detail-info">
          <h1>{m.title}</h1>
          <p className="muted">
            {m.author || "作者未填写"}
            <span className="dot">·</span>
            {m.chapterCount} 话
          </p>
          <p className="muted">
            {m.published ? `发布时间 ${m.published}` : "发布时间未填写"}
          </p>
          <div className="tags">
            {m.tags.map((t) => (
              <span className="tag" key={t}>
                {t}
              </span>
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
          <h2>
            章节目录 <small>共 {m.chapters.length} 话</small>
          </h2>
          <span className="muted">正序</span>
        </div>
        <div className="chapter-grid">
          {m.chapters.map((c, i) => (
            <Link
              key={c.id}
              to={`/read/${id}/${c.id}`}
              className="chapter-card"
            >
              <span className="chapter-number">
                {String(i + 1).padStart(2, "0")}
              </span>
              <div>
                <strong>{c.title}</strong>
                <small>{c.pages.length} 页</small>
              </div>
              <ArrowRight size={18} />
            </Link>
          ))}
        </div>
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
