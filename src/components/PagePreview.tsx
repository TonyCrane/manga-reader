import { useRef } from "react";
import { Link } from "react-router-dom";
import { media } from "../lib/api";
import type { MangaRouteState } from "../lib/navigation";
import type { Chapter } from "../types";

const pageSize = 100;

export function PagePreview({
  mangaId,
  chapters,
  readerRouteState,
  pageIndex,
  onPageIndexChange,
  onReaderOpen,
}: {
  mangaId: string;
  chapters: { chapter: Chapter; number: number }[];
  readerRouteState: MangaRouteState;
  pageIndex: number;
  onPageIndexChange: (page: number) => void;
  onReaderOpen: () => void;
}) {
  const top = useRef<HTMLDivElement>(null);
  function changePage(value: number) {
    onPageIndexChange(value);
    top.current?.scrollIntoView({ block: "start" });
  }
  const total = chapters.reduce(
    (sum, { chapter }) => sum + chapter.pages.length,
    0,
  );
  const count = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(pageIndex, count - 1);
  let offset = 0;
  const groups = chapters
    .map(({ chapter, number }) => {
      const start = Math.max(0, current * pageSize - offset);
      const end = Math.min(
        chapter.pages.length,
        (current + 1) * pageSize - offset,
      );
      offset += chapter.pages.length;
      return {
        chapter,
        number,
        start,
        pages: chapter.pages.slice(start, Math.max(start, end)),
      };
    })
    .filter((group) => group.pages.length);
  const navigation = (
    <nav className="preview-pagination" aria-label="页面预览分页">
      <button
        className="soft-button"
        disabled={current === 0}
        onClick={() => changePage(current - 1)}
      >
        上一页
      </button>
      <label>
        第{" "}
        <select
          aria-label="预览页码"
          value={current}
          onChange={(event) => changePage(Number(event.target.value))}
        >
          {Array.from({ length: count }, (_, index) => (
            <option key={index} value={index}>
              {index + 1}
            </option>
          ))}
        </select>{" "}
        / {count} 页
      </label>
      <button
        className="soft-button"
        disabled={current + 1 >= count}
        onClick={() => changePage(current + 1)}
      >
        下一页
      </button>
    </nav>
  );
  return (
    <div ref={top}>
      {navigation}
      {groups.map(({ chapter, number, start, pages }) => (
        <section key={chapter.id} className="preview-chapter">
          <h3>
            {String(number).padStart(2, "0")} · {chapter.title}
          </h3>
          {start > 0 && (
            <p className="preview-continuation">
              ··· 本话第 1–{start} 页预览在前面的分页中
            </p>
          )}
          <div className="preview-grid">
            {pages.map((page, index) => (
              <Link
                key={page.id}
                to={`/read/${mangaId}/${chapter.id}?page=${start + index + 1}`}
                state={readerRouteState}
                className="preview-page"
                onClick={onReaderOpen}
              >
                <div className="preview-image">
                  {page.thumbnail ? (
                    <img
                      src={media(page.thumbnail)}
                      alt={`${chapter.title} 第 ${start + index + 1} 页`}
                      loading="lazy"
                      decoding="async"
                    />
                  ) : (
                    <span>预览生成中</span>
                  )}
                </div>
                <span>第 {start + index + 1} 页</span>
              </Link>
            ))}
          </div>
          {start + pages.length < chapter.pages.length && (
            <p className="preview-continuation">
              本话尚有 {chapter.pages.length - start - pages.length}{" "}
              页，预览将在下一页继续 ···
            </p>
          )}
        </section>
      ))}
      {total > pageSize && navigation}
    </div>
  );
}
