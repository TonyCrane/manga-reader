import { loadTranslationSettings, translateWithDeepSeek } from "../translation";
import { localDateTime } from "../dates";
import { useEffect, useRef, useState } from "react";
import { ImagePlus, RotateCcw, Upload, Trash2 } from "lucide-react";
import { Sheet } from "./Sheet";
import { TagInput } from "./TagInput";
import { api, json, media } from "../api";
import type { Manga } from "../types";

export function MangaEditor({
  m,
  onClose,
  onSaved,
  onDelete,
}: {
  m: Manga;
  onClose: () => void;
  onSaved: () => Promise<unknown>;
  onDelete: () => void;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [cover, setCover] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [discard, setDiscard] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [tags, setTags] = useState(m.manual_tags ? m.tags : []);
  const [tagsEdited, setTagsEdited] = useState(false);
  const [chapterId, setChapterId] = useState(m.chapters[0]?.id || "");
  const titleInput = useRef<HTMLInputElement>(null);
  const titleZhInput = useRef<HTMLInputElement>(null);
  const translationRequest = useRef<AbortController | null>(null);
  const [translating, setTranslating] = useState(false);
  const [translationMessage, setTranslationMessage] = useState("");
  useEffect(() => () => translationRequest.current?.abort(), []);
  async function translateTitle() {
    if (translating || busy) {
      return;
    }
    const source =
      titleInput.current?.value.trim() || m.scanned_title || m.title;
    const previous = titleZhInput.current?.value || "";
    const controller = new AbortController();
    translationRequest.current = controller;
    const timeout = setTimeout(() => controller.abort(), 45000);
    setTranslating(true);
    setTranslationMessage("");
    try {
      const translated = await translateWithDeepSeek(
        source,
        await loadTranslationSettings(controller.signal),
        controller.signal,
      );
      if (controller.signal.aborted) {
        return;
      }
      const currentSource =
        titleInput.current?.value.trim() || m.scanned_title || m.title;
      if (
        currentSource !== source ||
        titleZhInput.current?.value !== previous
      ) {
        setTranslationMessage("标题已被修改，未覆盖当前内容，请重新翻译");
        return;
      }
      fillDefault(titleZhInput.current, translated);
      setTranslationMessage("已填入 DeepSeek 翻译结果，保存后生效");
    } catch (error) {
      setTranslationMessage(
        controller.signal.aborted
          ? "翻译已取消或超时，请重试"
          : error instanceof TypeError
            ? "无法连接 DeepSeek 翻译，请检查当前设备的网络或代理"
            : (error as Error).message,
      );
    } finally {
      clearTimeout(timeout);
      if (translationRequest.current === controller) {
        translationRequest.current = null;
        setTranslating(false);
      }
    }
  }
  const chapterInputs = useRef(new Map<string, HTMLInputElement>());
  const chapter = m.chapters.find((c) => c.id === chapterId);
  async function perform(fn: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function requestClose() {
    if (busy) {
      return;
    }
    if (dirty) {
      setDiscard(true);
      return;
    }
    onClose();
  }
  function fillDefault(
    input: HTMLInputElement | undefined | null,
    value: string,
  ) {
    if (!input) {
      return;
    }
    input.value = value;
    input.focus();
    setDirty(true);
  }
  return (
    <>
      <Sheet title="编辑漫画信息" onClose={requestClose}>
        <form
          onChange={() => setDirty(true)}
          onSubmit={(e) => {
            e.preventDefault();
            translationRequest.current?.abort();
            const f = new FormData(e.currentTarget);
            void perform(async () => {
              await api(
                `/manga/${m.id}`,
                json("PATCH", {
                  title: String(f.get("title")).trim() || null,
                  titleZh: String(f.get("titleZh")).trim(),
                  author: f.get("author"),
                  published: f.get("published"),
                  ...(f.get("created") !== localDateTime(m.created)
                    ? {
                        created: new Date(
                          String(f.get("created")),
                        ).toISOString(),
                      }
                    : {}),
                  ...(tagsEdited ? { tags } : {}),
                }),
              );
              for (const c of m.chapters) {
                const title = String(f.get(c.id)).trim() || null;
                if (title !== c.title_override) {
                  await api(`/chapters/${c.id}`, json("PATCH", { title }));
                }
              }
              await onSaved();
              onClose();
            });
          }}
        >
          <label>
            <span className="field-heading">
              日语标题
              <button
                type="button"
                className="fill-default"
                disabled={busy}
                onClick={() =>
                  fillDefault(titleInput.current, m.scanned_title || m.title)
                }
              >
                <RotateCcw size={13} />
                填入默认值
              </button>
            </span>
            <input
              ref={titleInput}
              name="title"
              defaultValue={m.title_override || ""}
              placeholder={m.scanned_title || m.title}
              maxLength={200}
            />
          </label>
          <label>
            <span className="field-heading">
              中文标题
              <button
                type="button"
                className="fill-default"
                aria-label="使用 DeepSeek 翻译日语标题"
                disabled={busy || translating}
                onClick={() => void translateTitle()}
              >
                {translating ? "翻译中…" : "DeepSeek 翻译"}
              </button>
            </span>
            <input
              ref={titleZhInput}
              aria-label="中文标题"
              name="titleZh"
              defaultValue={m.title_zh}
              placeholder="未填写"
              maxLength={200}
            />
          </label>
          {translationMessage && (
            <p className="hint" role="status">
              {translationMessage}
            </p>
          )}
          <div className="form-grid">
            <label>
              作者
              <input
                name="author"
                defaultValue={m.author}
                placeholder="未填写"
                maxLength={200}
              />
            </label>
            <label>
              发布时间
              <input name="published" type="date" defaultValue={m.published} />
            </label>
          </div>
          <label>
            导入时间
            <input
              name="created"
              type="datetime-local"
              required
              defaultValue={localDateTime(m.created)}
            />
          </label>
          <label>标签</label>
          <TagInput
            value={tags}
            onChange={(v) => {
              setTags(v);
              setTagsEdited(true);
              setDirty(true);
            }}
            placeholder="添加标签"
          />
          {!m.manual_tags && m.tags.length > 0 && !tagsEdited && (
            <p className="hint">扫描标签：{m.tags.join("、")}</p>
          )}
          <button
            type="button"
            className="soft-button cover-edit"
            onClick={() => setCover(true)}
          >
            <ImagePlus size={17} />
            更换封面
          </button>
          <h3>章节标题</h3>
          {m.chapters.map((c) => (
            <label key={c.id}>
              <span className="field-heading">
                {c.position + 1} 话
                <button
                  type="button"
                  className="fill-default"
                  disabled={busy}
                  onClick={() =>
                    fillDefault(
                      chapterInputs.current.get(c.id),
                      c.scanned_title || c.title,
                    )
                  }
                >
                  <RotateCcw size={13} />
                  填入默认值
                </button>
              </span>
              <input
                ref={(input) => {
                  if (input) {
                    chapterInputs.current.set(c.id, input);
                  } else {
                    chapterInputs.current.delete(c.id);
                  }
                }}
                name={c.id}
                defaultValue={c.title_override || ""}
                placeholder={c.scanned_title || c.title}
                maxLength={200}
              />
            </label>
          ))}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button className="primary full" disabled={busy}>
            保存修改
          </button>
          <button
            type="button"
            className="danger-button full"
            disabled={busy}
            onClick={() => setConfirm(true)}
          >
            <Trash2 size={16} />
            删除漫画
          </button>
        </form>
      </Sheet>
      {cover && (
        <Sheet title="更换封面" onClose={() => setCover(false)}>
          <label className="upload-button">
            <Upload size={19} />
            上传封面图片
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/avif"
              disabled={busy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  void perform(async () => {
                    const body = new FormData();
                    body.set("cover", file);
                    await api(`/manga/${m.id}/cover`, { method: "POST", body });
                    await onSaved();
                    setCover(false);
                  });
                }
              }}
            />
          </label>
          <label>
            选择章节
            <select
              value={chapterId}
              onChange={(e) => setChapterId(e.target.value)}
            >
              {m.chapters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          </label>
          <div className="cover-picker" key={chapterId}>
            {chapter?.pages.map((p, i) => (
              <button
                key={p.id}
                disabled={busy}
                aria-label={`选择第 ${i + 1} 页为封面`}
                onClick={() =>
                  perform(async () => {
                    await api(
                      `/manga/${m.id}/cover`,
                      json("PUT", { pageId: p.id }),
                    );
                    await onSaved();
                    setCover(false);
                  })
                }
              >
                <img
                  src={media(p.optimized)}
                  alt={`第 ${i + 1} 页`}
                  loading="lazy"
                />
                <span>{i + 1}</span>
              </button>
            ))}
          </div>
          {error && <p className="error">{error}</p>}
        </Sheet>
      )}
      {confirm && (
        <Sheet title="删除漫画" onClose={() => setConfirm(false)}>
          <p>
            删除「{m.title}
            」的漫画信息、章节、处理图片和上传封面。原始漫画目录和图片会保留。
          </p>
          <p className="hint">
            若目录仍在导入源中，后续刷新会重新导入这部漫画。
          </p>
          {error && <p className="error">{error}</p>}
          <div className="confirm-actions">
            <button className="soft-button" onClick={() => setConfirm(false)}>
              取消
            </button>
            <button
              className="danger-button"
              disabled={busy}
              onClick={() =>
                perform(async () => {
                  await api(`/manga/${m.id}`, { method: "DELETE" });
                  onDelete();
                })
              }
            >
              确认删除
            </button>
          </div>
        </Sheet>
      )}
      {discard && (
        <Sheet title="放弃未保存的修改？" onClose={() => setDiscard(false)}>
          <p>你对漫画信息或章节标题的修改还没有保存。</p>
          <p className="hint">放弃后，这些修改将无法恢复。</p>
          <div className="confirm-actions">
            <button className="soft-button" onClick={() => setDiscard(false)}>
              继续编辑
            </button>
            <button className="danger-button" onClick={onClose}>
              放弃修改
            </button>
          </div>
        </Sheet>
      )}
    </>
  );
}
