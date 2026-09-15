import { useRef, useState } from "react";
import { RotateCcw } from "lucide-react";
import { api, json } from "../api";
import type { Chapter } from "../types";
import { Sheet } from "./Sheet";

const pageSize = 50;

export function ChapterTitleEditor({
  chapters,
  onClose,
  onSaved,
}: {
  chapters: Chapter[];
  onClose: () => void;
  onSaved: () => Promise<unknown>;
}) {
  const [pageIndex, setPageIndex] = useState(0);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [discard, setDiscard] = useState(false);
  const chapterInputs = useRef(new Map<string, HTMLInputElement>());
  const summary = useRef<HTMLParagraphElement>(null);
  const pageCount = Math.max(1, Math.ceil(chapters.length / pageSize));
  const currentPage = Math.min(pageIndex, pageCount - 1);
  const visibleChapters = chapters.slice(
    currentPage * pageSize,
    (currentPage + 1) * pageSize,
  );
  const dirty = Object.keys(drafts).length > 0;

  function titleValue(chapter: Chapter) {
    return Object.hasOwn(drafts, chapter.id)
      ? drafts[chapter.id]
      : chapter.title_override || "";
  }

  function changeTitle(chapter: Chapter, value: string) {
    setDrafts((current) => {
      const next = { ...current };
      if (value === (chapter.title_override || "")) {
        delete next[chapter.id];
      } else {
        next[chapter.id] = value;
      }
      return next;
    });
  }

  function changePage(nextPage: number) {
    setPageIndex(nextPage);
    summary.current?.closest(".sheet-inner")?.scrollTo({ top: 0 });
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

  function pagination() {
    if (pageCount <= 1) {
      return null;
    }
    return (
      <nav className="chapter-title-pagination" aria-label="章节标题分页">
        <button
          type="button"
          className="soft-button"
          disabled={currentPage === 0}
          onClick={() => changePage(currentPage - 1)}
        >
          上一页
        </button>
        <label>
          第
          <select
            aria-label="章节标题页码"
            value={currentPage}
            onChange={(event) => changePage(Number(event.target.value))}
          >
            {Array.from({ length: pageCount }, (_, index) => (
              <option key={index} value={index}>
                {index + 1}
              </option>
            ))}
          </select>
          / {pageCount} 页
        </label>
        <button
          type="button"
          className="soft-button"
          disabled={currentPage + 1 >= pageCount}
          onClick={() => changePage(currentPage + 1)}
        >
          下一页
        </button>
      </nav>
    );
  }

  return (
    <>
      <Sheet
        title="编辑章节标题"
        className="chapter-title-sheet"
        onClose={requestClose}
      >
        <p ref={summary} className="muted chapter-title-summary">
          共 {chapters.length} 话
        </p>
        {pagination()}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setBusy(true);
            setError("");
            void (async () => {
              try {
                for (const [id, value] of Object.entries(drafts)) {
                  await api(
                    `/chapters/${id}`,
                    json("PATCH", { title: value.trim() || null }),
                  );
                }
                await onSaved();
                onClose();
              } catch (error) {
                setError((error as Error).message);
              } finally {
                setBusy(false);
              }
            })();
          }}
        >
          <div className="chapter-title-fields">
            {visibleChapters.map((chapter) => (
              <label key={chapter.id}>
                <span className="field-heading">
                  {chapter.position + 1} 话
                  <button
                    type="button"
                    className="fill-default"
                    disabled={busy}
                    onClick={() => {
                      changeTitle(
                        chapter,
                        chapter.scanned_title || chapter.title,
                      );
                      chapterInputs.current.get(chapter.id)?.focus();
                    }}
                  >
                    <RotateCcw size={13} />
                    填入默认值
                  </button>
                </span>
                <input
                  ref={(input) => {
                    if (input) {
                      chapterInputs.current.set(chapter.id, input);
                    } else {
                      chapterInputs.current.delete(chapter.id);
                    }
                  }}
                  value={titleValue(chapter)}
                  placeholder={chapter.scanned_title || chapter.title}
                  maxLength={200}
                  disabled={busy}
                  onChange={(event) => changeTitle(chapter, event.target.value)}
                />
              </label>
            ))}
          </div>
          {pagination()}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button className="primary full" disabled={busy || !dirty}>
            {busy ? "正在保存…" : "保存章节标题"}
          </button>
        </form>
      </Sheet>
      {discard && (
        <Sheet title="放弃未保存的修改？" onClose={() => setDiscard(false)}>
          <p>你对章节标题的修改还没有保存。</p>
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
