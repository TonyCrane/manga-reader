import {
  useEffect,
  useRef,
  useId,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { X } from "lucide-react";

type DragSample = {
  y: number;
  time: number;
};

type DragState = {
  pointerId: number;
  startY: number;
  startOffset: number;
  samples: DragSample[];
};

function rubberband(distance: number, dimension: number) {
  const constant = 0.35;
  return (
    (distance * dimension * constant) /
    (dimension + constant * Math.abs(distance))
  );
}

function projectedOffset(offset: number, velocity: number) {
  const decelerationRate = 0.99;
  return (
    offset + (velocity / 1000) * (decelerationRate / (1 - decelerationRate))
  );
}

export function Sheet({
  title,
  className = "",
  children,
  onClose,
}: {
  title: string;
  className?: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const drag = useRef<DragState | null>(null);
  const offset = useRef(0);
  const panelHeight = useRef(1);
  const animation = useRef<number | null>(null);
  const closing = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const titleId = useId();

  function stopAnimation() {
    if (animation.current !== null) {
      cancelAnimationFrame(animation.current);
      animation.current = null;
    }
  }

  function renderOffset(value: number) {
    offset.current = value;
    const el = panel.current;
    if (!el) {
      return;
    }
    el.style.setProperty("--sheet-drag-y", `${value}px`);
    const progress = Math.min(1, Math.max(0, value / panelHeight.current));
    ref.current?.style.setProperty(
      "--sheet-backdrop-opacity",
      String(1 - progress),
    );
  }

  function clearOffset() {
    offset.current = 0;
    panel.current?.style.removeProperty("--sheet-drag-y");
    panel.current?.style.removeProperty("will-change");
    ref.current?.style.removeProperty("--sheet-backdrop-opacity");
  }

  function animateTo(
    target: number,
    initialVelocity: number,
    onComplete?: () => void,
  ) {
    stopAnimation();
    const reducedMotion = matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (reducedMotion) {
      if (target === 0) {
        clearOffset();
      } else {
        renderOffset(target);
      }
      onComplete?.();
      return;
    }

    let position = offset.current;
    let velocity = initialVelocity;
    let previousTime = performance.now();
    panel.current?.style.setProperty("will-change", "transform");
    const step = (time: number) => {
      const elapsed = Math.min((time - previousTime) / 1000, 1 / 30);
      previousTime = time;
      const acceleration = -420 * (position - target) - 41 * velocity;
      velocity += acceleration * elapsed;
      position += velocity * elapsed;
      renderOffset(position);
      if (Math.abs(position - target) < 0.5 && Math.abs(velocity) < 8) {
        animation.current = null;
        if (target === 0) {
          clearOffset();
        } else {
          renderOffset(target);
        }
        onComplete?.();
        return;
      }
      animation.current = requestAnimationFrame(step);
    };
    animation.current = requestAnimationFrame(step);
  }

  function resetPanel(velocity = 0) {
    animateTo(0, velocity);
  }

  function dismissPanel(velocity: number) {
    const el = panel.current;
    if (!el || closing.current) {
      return;
    }
    closing.current = true;
    panelHeight.current = Math.max(1, el.offsetHeight);
    animateTo(panelHeight.current + 48, Math.max(0, velocity), () => {
      onCloseRef.current();
      requestAnimationFrame(() => {
        if (panel.current?.isConnected) {
          closing.current = false;
          resetPanel();
        }
      });
    });
  }

  function startDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || closing.current) {
      return;
    }
    stopAnimation();
    panelHeight.current = Math.max(1, panel.current?.offsetHeight ?? 1);
    panel.current?.style.setProperty("will-change", "transform");
    drag.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startOffset: offset.current,
      samples: [{ y: event.clientY, time: event.timeStamp }],
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function moveDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const current = drag.current;
    const el = panel.current;
    if (!current || current.pointerId !== event.pointerId || !el) {
      return;
    }
    const rawOffset = current.startOffset + event.clientY - current.startY;
    renderOffset(
      rawOffset >= 0 ? rawOffset : -rubberband(-rawOffset, panelHeight.current),
    );
    current.samples.push({ y: event.clientY, time: event.timeStamp });
    current.samples = current.samples.filter(
      (sample) => event.timeStamp - sample.time <= 120,
    );
  }

  function finishDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const current = drag.current;
    const el = panel.current;
    if (!current || current.pointerId !== event.pointerId || !el) {
      return;
    }
    drag.current = null;
    const samples = [
      ...current.samples,
      { y: event.clientY, time: event.timeStamp },
    ];
    const first = samples[0];
    const last = samples[samples.length - 1];
    const elapsed = last.time - first.time;
    const velocity = elapsed > 0 ? ((last.y - first.y) / elapsed) * 1000 : 0;
    const threshold = Math.min(180, Math.max(96, panelHeight.current * 0.3));
    const shouldDismiss =
      offset.current > 24 &&
      (offset.current >= threshold ||
        velocity >= 900 ||
        projectedOffset(offset.current, velocity) >= threshold);
    if (shouldDismiss) {
      dismissPanel(velocity);
    } else {
      resetPanel(velocity);
    }
  }

  function cancelDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (drag.current?.pointerId !== event.pointerId) {
      return;
    }
    drag.current = null;
    resetPanel();
  }

  useEffect(() => {
    const el = ref.current!;
    const previous = document.activeElement as HTMLElement;
    el.showModal();
    return () => {
      stopAnimation();
      el.close();
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      className={`sheet ${className}`}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div ref={panel} className="sheet-motion">
        <div className="sheet-inner">
          <div
            className="sheet-drag-region"
            aria-hidden="true"
            onPointerDown={startDrag}
            onPointerMove={moveDrag}
            onPointerUp={finishDrag}
            onPointerCancel={cancelDrag}
            onLostPointerCapture={cancelDrag}
          >
            <div className="handle" />
          </div>
          <header>
            <h2 id={titleId}>{title}</h2>
            <button className="icon" aria-label="关闭" onClick={onClose}>
              <X size={22} />
            </button>
          </header>
          {children}
        </div>
        <div className="sheet-drag-fill" aria-hidden="true" />
      </div>
    </dialog>
  );
}
