import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import {
  ArrowLeft,
  Settings,
  List,
  ChevronLeft,
  ChevronRight,
  Columns2,
} from "lucide-react";
import { api, pageMedia } from "../lib/api";
import type { Manga, Page } from "../types";
import { Sheet } from "../components/Sheet";
import { spreads, spreadIndex } from "./pagination";
import { useGestures } from "./useGestures";
import { isMangaRouteState } from "../lib/navigation";
import "./reader.css";

type Preferences = {
  mode: "manga" | "scroll";
  quality: "optimized" | "original";
  numbers: boolean;
};

type LandscapePagePreferences = Record<string, 1 | 2>;

function preferences(): Preferences {
  try {
    const p = JSON.parse(localStorage.getItem("reader") || "{}");
    return {
      mode: p.mode === "scroll" ? "scroll" : "manga",
      quality: p.quality === "original" ? "original" : "optimized",
      numbers: p.numbers !== false,
    };
  } catch {
    return { mode: "manga", quality: "optimized", numbers: true };
  }
}

function landscapePagePreferences(): LandscapePagePreferences {
  try {
    const stored = JSON.parse(
      localStorage.getItem("reader-landscape-pages") || "{}",
    );
    if (!stored || typeof stored !== "object" || Array.isArray(stored)) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(stored).filter(
        ([mangaId, value]) =>
          /^[a-f0-9]{24}$/.test(mangaId) && (value === 1 || value === 2),
      ),
    ) as LandscapePagePreferences;
  } catch {
    return {};
  }
}

export function Reader() {
  const { id, chapterId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const routeState = location.state;
  const [m, setM] = useState<Manga | null>(null);
  const [error, setError] = useState("");
  const [searchParams] = useSearchParams();
  const requestedPage = Number(searchParams.get("page"));
  const initialPage =
    Number.isSafeInteger(requestedPage) && requestedPage > 0
      ? requestedPage - 1
      : 0;
  const [page, setPage] = useState(initialPage);
  const [menu, setMenu] = useState(false);
  const [sheet, setSheet] = useState<"settings" | "chapters" | null>(null);
  const [prefs, setPrefs] = useState(preferences);
  const [landscapePagesByManga, setLandscapePagesByManga] = useState(
    landscapePagePreferences,
  );
  const [shifted, setShifted] = useState(false);
  const [landscape, setLandscape] = useState(() => innerWidth > innerHeight);
  const [toast, setToast] = useState("");
  const stage = useRef<HTMLDivElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const lastChapter = useRef(chapterId);
  const scrollTarget = useRef<string | null>(null);
  const preloadedImages = useRef(new Map<string, HTMLImageElement>());
  const loadedFrame = useRef({ key: "", pages: new Set<string>() });
  const [readyFrame, setReadyFrame] = useState("");
  const ci = m?.chapters.findIndex((c) => c.id === chapterId) ?? -1;
  const chapter = m?.chapters[ci];
  const landscapePages = id && landscapePagesByManga[id] === 1 ? 1 : 2;
  const double = landscape && prefs.mode === "manga" && landscapePages === 2;
  const pairs = useMemo(
    () => spreads(chapter?.pages.length || 0, shifted),
    [chapter?.pages.length, shifted],
  );
  const pairIndex = spreadIndex(page, shifted);
  const visible = double ? pairs[pairIndex] || [] : [page];
  const visiblePageIds = visible.flatMap((index) =>
    index === null || !chapter?.pages[index] ? [] : [chapter.pages[index].id],
  );
  const frameKey = chapter
    ? `${chapter.id}:${prefs.quality}:${visiblePageIds.join(",")}`
    : "";
  function currentImageLoaded(pageId: string) {
    if (!frameKey || !visiblePageIds.includes(pageId)) {
      return;
    }
    if (loadedFrame.current.key !== frameKey) {
      loadedFrame.current = { key: frameKey, pages: new Set() };
    }
    loadedFrame.current.pages.add(pageId);
    if (loadedFrame.current.pages.size === visiblePageIds.length) {
      setReadyFrame(frameKey);
    }
  }
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    api<Manga>(`/manga/${id}`, { signal: controller.signal })
      .then(setM)
      .catch((e) => {
        if (!controller.signal.aborted) {
          setError(e.message);
        }
      });
    return () => controller.abort();
  }, [id]);
  useEffect(() => {
    if (chapter && searchParams.has("page")) {
      const target = Math.min(
        initialPage,
        Math.max(0, chapter.pages.length - 1),
      );
      setPage(target);
      if (prefs.mode === "scroll") {
        document
          .getElementById(`scroll-${chapter.id}-${target}`)
          ?.scrollIntoView();
      }
    }
  }, [chapter, searchParams]);
  useEffect(() => {
    localStorage.setItem("reader", JSON.stringify(prefs));
  }, [prefs]);
  useEffect(() => {
    localStorage.setItem(
      "reader-landscape-pages",
      JSON.stringify(landscapePagesByManga),
    );
  }, [landscapePagesByManga]);
  useEffect(() => {
    const onResize = () => setLandscape(innerWidth > innerHeight);
    window.addEventListener("resize", onResize);
    document.body.classList.add("reading");
    const meta = document.querySelector('meta[name="theme-color"]');
    const old = meta?.getAttribute("content");
    meta?.setAttribute("content", "#000000");
    return () => {
      window.removeEventListener("resize", onResize);
      document.body.classList.remove("reading");
      meta?.setAttribute("content", old || "#f8f9fc");
    };
  }, []);
  useEffect(() => {
    const className = "reader-menu-open";
    const color = menu ? "#101118" : "#000000";
    document.documentElement.classList.toggle(className, menu);
    document.body.classList.toggle(className, menu);
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", color);
    return () => {
      document.documentElement.classList.remove(className);
      document.body.classList.remove(className);
    };
  }, [menu]);
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(""), 2200);
      return () => clearTimeout(timer);
    }
  }, [toast]);
  const goChapter = useCallback(
    (index: number, last = false) => {
      const next = m?.chapters[index];
      if (!next) {
        setToast(index < 0 ? "已经是第一页" : "已经读到最后一页");
        return;
      }
      setPage(last ? next.pages.length - 1 : 0);
      navigate(`/read/${id}/${next.id}`, {
        replace: true,
        state: routeState,
      });
      setToast(next.title);
      setSheet(null);
      scrollTarget.current = next.id;
    },
    [m, id, navigate, routeState],
  );
  const turn = useCallback(
    (direction: number) => {
      if (!chapter) {
        return;
      }
      if (double) {
        const next = pairIndex + direction;
        if (next < 0) {
          goChapter(ci - 1, true);
        } else if (next >= pairs.length) {
          goChapter(ci + 1);
        } else {
          setPage(pairs[next].find((p): p is number => p !== null)!);
        }
      } else {
        const next = page + direction;
        if (next < 0) {
          goChapter(ci - 1, true);
        } else if (next >= chapter.pages.length) {
          goChapter(ci + 1);
        } else {
          setPage(next);
        }
      }
    },
    [chapter, double, pairIndex, pairs, ci, page, goChapter],
  );
  function adjacent(direction: number) {
    if (!chapter || !m) {
      return null;
    }
    const next = (double ? pairIndex : page) + direction;
    const count = double ? pairs.length : chapter.pages.length;
    if (next >= 0 && next < count) {
      return { chapter, indices: double ? pairs[next] : [next] };
    }
    const neighbor = m.chapters[ci + direction];
    if (!neighbor?.pages.length) {
      return null;
    }
    const neighborPairs = spreads(neighbor.pages.length, shifted);
    return {
      chapter: neighbor,
      indices: double
        ? neighborPairs[direction > 0 ? 0 : neighborPairs.length - 1]
        : [direction > 0 ? 0 : neighbor.pages.length - 1],
    };
  }
  const { view, drag, reset } = useGestures(
    stage,
    !!chapter && prefs.mode === "manga" && !sheet,
    turn,
    () => setMenu((v) => !v),
    () => {
      if (landscape) {
        setShifted((v) => !v);
        setToast(shifted ? "已切换为 1 / 2 配对" : "已切换为 2 / 3 配对");
      }
    },
    (direction) => adjacent(direction) !== null,
  );
  useEffect(() => {
    reset();
  }, [page, chapterId, landscape, prefs.mode, landscapePages, shifted]);
  useEffect(() => {
    preloadedImages.current.clear();
  }, [id, prefs.mode, prefs.quality]);
  useEffect(() => {
    if (prefs.mode !== "manga" || !m || !chapter || readyFrame !== frameKey) {
      return;
    }
    const currentPageIds = new Set(visiblePageIds);
    const ahead = chapter.pages
      .slice(page + 1, page + 10)
      .filter((item) => !currentPageIds.has(item.id))
      .slice(0, 8)
      .map((page) => ({ chapterId: chapter.id, page }));
    if (ahead.length < 8) {
      ahead.push(
        ...(m.chapters[ci + 1]?.pages
          .slice(0, 8 - ahead.length)
          .map((page) => ({ chapterId: m.chapters[ci + 1].id, page })) || []),
      );
    }
    const behind = chapter.pages
      .slice(Math.max(0, page - 2), page)
      .reverse()
      .map((page) => ({ chapterId: chapter.id, page }));
    if (behind.length < 2) {
      behind.push(
        ...(m.chapters[ci - 1]?.pages
          .slice(behind.length - 2)
          .reverse()
          .map((page) => ({ chapterId: m.chapters[ci - 1].id, page })) || []),
      );
    }
    const currentUrls = new Set(
      visible.flatMap((index) =>
        index === null || !chapter.pages[index]
          ? []
          : [pageMedia(chapter.id, chapter.pages[index], prefs.quality)],
      ),
    );
    const urls = [
      ...new Set(
        [...ahead, ...behind]
          .map((item) => pageMedia(item.chapterId, item.page, prefs.quality))
          .filter((url) => !currentUrls.has(url)),
      ),
    ];
    const wanted = new Set(urls);
    for (const url of preloadedImages.current.keys()) {
      if (!wanted.has(url)) {
        preloadedImages.current.delete(url);
      }
    }
    const decodeCount = prefs.quality === "optimized" ? 4 : 2;
    urls.forEach((url, index) => {
      let image = preloadedImages.current.get(url);
      if (!image) {
        image = new Image();
        image.decoding = "async";
        image.fetchPriority = "auto";
        image.src = url;
        preloadedImages.current.set(url, image);
      }
      if (index < decodeCount) {
        void image.decode().catch(() => {});
      }
    });
  }, [m, chapter, ci, page, prefs.mode, prefs.quality, readyFrame, frameKey]);
  useEffect(
    () => () => {
      preloadedImages.current.clear();
    },
    [],
  );
  useEffect(() => {
    if (lastChapter.current !== chapterId) {
      lastChapter.current = chapterId;
      if (prefs.mode === "scroll" && scrollTarget.current) {
        document
          .getElementById(`scroll-${scrollTarget.current}-0`)
          ?.scrollIntoView();
        scrollTarget.current = null;
      }
    }
  }, [chapterId, prefs.mode]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (sheet) {
        return;
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        turn(1);
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        turn(-1);
      }
      if (e.key === "Escape") {
        setMenu((v) => !v);
      }
      if (e.key === " ") {
        e.preventDefault();
        setMenu((v) => !v);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [turn, sheet]);
  useEffect(() => {
    if (prefs.mode !== "scroll" || !scroll.current || !m) {
      return;
    }
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const root = scroll.current!;
        const target = root.scrollTop + root.clientHeight * 0.35;
        const elements = root.querySelectorAll<HTMLElement>("[data-page]");
        let low = 0;
        let high = elements.length - 1;
        let el: HTMLElement | null = null;
        while (low <= high) {
          const middle = Math.floor((low + high) / 2);
          const candidate = elements[middle];
          if (candidate.offsetTop <= target) {
            el = candidate;
            low = middle + 1;
          } else {
            high = middle - 1;
          }
        }
        if (el && el.offsetTop + el.offsetHeight <= target) {
          el = null;
        }
        if (el) {
          setPage(Number(el.dataset.page));
          if (el.dataset.chapter !== chapterId) {
            navigate(`/read/${id}/${el.dataset.chapter}`, {
              replace: true,
              state: routeState,
            });
            setToast(
              m.chapters.find((c) => c.id === el.dataset.chapter)?.title || "",
            );
          }
        }
      });
    };
    const el = scroll.current;
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, [prefs.mode, m, chapterId, id, navigate, routeState]);
  useEffect(() => {
    if (prefs.mode === "scroll" && chapter) {
      document.getElementById(`scroll-${chapter.id}-${page}`)?.scrollIntoView();
    }
  }, [prefs.mode, !!m]);
  function seek(value: number) {
    setPage(value);
    if (prefs.mode === "scroll") {
      document.getElementById(`scroll-${chapterId}-${value}`)?.scrollIntoView();
    }
  }
  function returnToManga() {
    if (isMangaRouteState(routeState, id)) {
      navigate(-1);
      return;
    }
    navigate(`/manga/${id}`, { replace: true });
  }
  function returnToLibrary() {
    if (isMangaRouteState(routeState, id) && routeState.libraryBehind) {
      navigate(-2);
      return;
    }
    navigate("/", { replace: true });
  }
  if (error) {
    return (
      <div className="reader-error">
        {error}
        <button onClick={returnToLibrary}>返回书架</button>
      </div>
    );
  }
  if (!m) {
    return (
      <div className="reader-error">
        <span className="reader-spinner" aria-hidden="true" />
        正在载入漫画…
      </div>
    );
  }
  if (!chapter) {
    return (
      <div className="reader-error">
        章节不存在
        <button onClick={returnToManga}>返回目录</button>
      </div>
    );
  }
  return (
    <div className="reader">
      <div
        ref={stage}
        className={`reader-stage ${prefs.mode === "scroll" ? "hidden" : ""}`}
        role="region"
        aria-label="漫画阅读区域，左侧下一页，右侧上一页，中间打开菜单"
      >
        {[-1, 0, 1].map((direction) => {
          const frame =
            direction === 0
              ? { chapter, indices: visible }
              : adjacent(direction);
          if (!frame) {
            return null;
          }
          return (
            <div
              key={direction}
              className="page-frame"
              aria-hidden={direction !== 0}
              inert={direction !== 0}
              style={{
                transform: `translate3d(calc(${-direction * 100}% + ${drag}px),0,0)`,
              }}
            >
              <div
                className={`spread ${double ? "double" : ""}`}
                style={{
                  transform:
                    direction === 0
                      ? `translate3d(${view.x}px,${view.y}px,0) scale(${view.scale})`
                      : undefined,
                }}
              >
                {[...frame.indices]
                  .reverse()
                  .map((index, i) =>
                    index === null ? (
                      <div
                        className="blank-page"
                        key={`blank-${i}`}
                        aria-label="空白补页"
                      />
                    ) : (
                      <ReaderImage
                        key={`${frame.chapter.id}-${index}-${prefs.quality}`}
                        chapterId={frame.chapter.id}
                        page={frame.chapter.pages[index]}
                        quality={prefs.quality}
                        number={index + 1}
                        priority={direction === 0}
                        onLoad={
                          direction === 0 ? currentImageLoaded : undefined
                        }
                      />
                    ),
                  )}
              </div>
            </div>
          );
        })}
      </div>
      {prefs.mode === "scroll" && (
        <div
          ref={scroll}
          className="scroll-reader"
          onClick={() => setMenu((v) => !v)}
        >
          {m.chapters.map((c) => (
            <section key={c.id}>
              {c.pages.map((p, i) => (
                <div
                  key={p.id}
                  id={`scroll-${c.id}-${i}`}
                  data-page={i}
                  data-chapter={c.id}
                  className="scroll-page"
                  style={{ aspectRatio: p.width / p.height }}
                >
                  <img
                    src={pageMedia(c.id, p, prefs.quality)}
                    alt={`${c.title} 第 ${i + 1} 页`}
                    loading="lazy"
                    decoding="async"
                  />
                  {prefs.numbers && (
                    <span>
                      {i + 1} / {c.pages.length}
                    </span>
                  )}
                </div>
              ))}
            </section>
          ))}
        </div>
      )}
      {prefs.numbers && prefs.mode === "manga" && (
        <div className="page-number">
          {double ? (visible[0] === null ? 1 : visible[0]! + 1) : page + 1} /{" "}
          {chapter.pages.length}
        </div>
      )}
      {toast && (
        <div className="reader-toast" role="status">
          {toast}
        </div>
      )}
      <>
        <header
          className="reader-top"
          data-open={menu}
          inert={!menu}
          aria-hidden={!menu}
        >
          <button
            className="icon"
            aria-label="返回章节目录"
            onClick={returnToManga}
          >
            <ArrowLeft size={24} />
          </button>
          <div>
            <strong>{chapter.title}</strong>
            <small>{m.title}</small>
          </div>
        </header>
        <div
          className="reader-controls"
          data-open={menu}
          inert={!menu}
          aria-hidden={!menu}
        >
          <div className="progress-row">
            <button
              className="icon"
              aria-label="上一话"
              onClick={() => goChapter(ci - 1)}
            >
              <ChevronLeft size={22} />
            </button>
            <input
              type="range"
              aria-label="阅读进度"
              min={0}
              max={chapter.pages.length - 1}
              value={page}
              onChange={(e) => seek(Number(e.target.value))}
            />
            <span>
              {page + 1}/{chapter.pages.length}
            </span>
            <button
              className="icon"
              aria-label="下一话"
              onClick={() => goChapter(ci + 1)}
            >
              <ChevronRight size={22} />
            </button>
          </div>
          <div className="reader-actions">
            <button onClick={() => setSheet("settings")}>
              <Settings size={23} />
              设置
            </button>
            {double && (
              <button
                onClick={() => {
                  setShifted((v) => !v);
                  setToast(
                    shifted ? "已切换为 1 / 2 配对" : "已切换为 2 / 3 配对",
                  );
                }}
              >
                <Columns2 size={23} />
                {shifted ? "错位配对" : "跨页配对"}
              </button>
            )}
            <button onClick={() => setSheet("chapters")}>
              <List size={24} />
              章节
            </button>
          </div>
        </div>
      </>
      {!menu && (
        <button
          className="reader-menu-access"
          aria-label="打开阅读菜单"
          onClick={() => setMenu(true)}
        >
          菜单
        </button>
      )}
      {sheet && (
        <Sheet
          title={sheet === "settings" ? "阅读设置" : "章节目录"}
          onClose={() => setSheet(null)}
        >
          {sheet === "settings" ? (
            <>
              <div className="reader-setting">
                <span>阅读模式</span>
                <div className="segmented">
                  <button
                    className={prefs.mode === "manga" ? "selected" : ""}
                    onClick={() => setPrefs({ ...prefs, mode: "manga" })}
                  >
                    ← 日漫
                  </button>
                  <button
                    className={prefs.mode === "scroll" ? "selected" : ""}
                    onClick={() => setPrefs({ ...prefs, mode: "scroll" })}
                  >
                    ↓ 滚动
                  </button>
                </div>
              </div>
              <div className="reader-setting">
                <span>画质</span>
                <div className="segmented">
                  <button
                    className={prefs.quality === "optimized" ? "selected" : ""}
                    onClick={() => setPrefs({ ...prefs, quality: "optimized" })}
                  >
                    优化
                  </button>
                  <button
                    className={prefs.quality === "original" ? "selected" : ""}
                    onClick={() => setPrefs({ ...prefs, quality: "original" })}
                  >
                    原图
                  </button>
                </div>
              </div>
              {landscape && prefs.mode === "manga" && (
                <div className="reader-setting">
                  <span>横屏显示</span>
                  <div className="segmented">
                    <button
                      className={landscapePages === 1 ? "selected" : ""}
                      onClick={() => {
                        if (id) {
                          setLandscapePagesByManga((current) => ({
                            ...current,
                            [id]: 1,
                          }));
                        }
                      }}
                    >
                      单页
                    </button>
                    <button
                      className={landscapePages === 2 ? "selected" : ""}
                      onClick={() => {
                        if (id) {
                          setLandscapePagesByManga((current) => ({
                            ...current,
                            [id]: 2,
                          }));
                        }
                      }}
                    >
                      双页
                    </button>
                  </div>
                </div>
              )}
              <div className="reader-setting">
                <span>展示页码</span>
                <button
                  role="switch"
                  aria-checked={prefs.numbers}
                  aria-label="展示页码"
                  className={`switch ${prefs.numbers ? "on" : ""}`}
                  onClick={() =>
                    setPrefs({ ...prefs, numbers: !prefs.numbers })
                  }
                >
                  <span />
                </button>
              </div>
            </>
          ) : (
            <div className="reader-chapters">
              {m.chapters.map((c, i) => (
                <button
                  className={c.id === chapterId ? "selected" : ""}
                  key={c.id}
                  onClick={() => {
                    if (c.id === chapterId) {
                      seek(0);
                      setSheet(null);
                    } else {
                      goChapter(i);
                    }
                  }}
                >
                  <span>{c.title}</span>
                  <small>{c.pages.length} 页</small>
                </button>
              ))}
            </div>
          )}
        </Sheet>
      )}
    </div>
  );
}

function ReaderImage({
  chapterId,
  page,
  quality,
  number,
  priority,
  onLoad,
}: {
  chapterId: string;
  page: Page;
  quality: "original" | "optimized";
  number: number;
  priority: boolean;
  onLoad?: (pageId: string) => void;
}) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [retry, setRetry] = useState(0);
  if (!page) {
    return null;
  }
  return (
    <div className="reader-image">
      {!loaded && !failed && (
        <span
          className="reader-loading-indicator"
          role="status"
          aria-label={`正在加载第 ${number} 页`}
        >
          <span className="reader-spinner" aria-hidden="true" />
        </span>
      )}
      {failed ? (
        <button
          className="retry"
          onClick={() => {
            setFailed(false);
            setLoaded(false);
            setRetry((r) => r + 1);
          }}
        >
          重新加载图片
        </button>
      ) : (
        <img
          src={
            pageMedia(chapterId, page, quality) +
            (retry ? `?retry=${retry}` : "")
          }
          alt={`第 ${number} 页`}
          draggable={false}
          decoding="async"
          fetchPriority={priority ? "high" : "low"}
          onLoad={() => {
            setLoaded(true);
            onLoad?.(page.id);
          }}
          onError={() => {
            setLoaded(false);
            setFailed(true);
          }}
        />
      )}
    </div>
  );
}
