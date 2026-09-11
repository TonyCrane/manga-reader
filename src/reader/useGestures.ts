import { useEffect, useRef, useState, type RefObject } from "react";

type Point = { x: number; y: number };

export function useGestures(
  ref: RefObject<HTMLDivElement | null>,
  enabled: boolean,
  onTurn: (direction: number) => void,
  onMenu: () => void,
  onSpread: () => void,
  canTurn: (direction: number) => boolean,
) {
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
  const [drag, setDrag] = useState(0);
  const dragRef = useRef(0);
  const animation = useRef(0);
  const setPosition = (x: number) => {
    dragRef.current = x;
    setDrag(x);
  };
  const current = useRef(view);
  const callbacks = useRef({ onTurn, onMenu, onSpread, canTurn });
  callbacks.current = { onTurn, onMenu, onSpread, canTurn };
  const reset = () => {
    cancelAnimationFrame(animation.current);
    setPosition(0);
    current.current = { scale: 1, x: 0, y: 0 };
    setView(current.current);
  };
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) {
      return;
    }
    const points = new Map<number, Point>();
    let start: Point = { x: 0, y: 0 };
    let base = current.current;
    let startTime = 0;
    let hadTwo = false;
    let moved = false;
    let distance = 0;
    let grab = 0;
    let velocity = 0;
    let lastMove = 0;
    let horizontal = false;
    const settle = (
      target: number,
      direction: number,
      initialVelocity: number,
    ) => {
      cancelAnimationFrame(animation.current);
      const finish = () => {
        setPosition(0);
        if (direction) {
          callbacks.current.onTurn(direction);
        }
      };
      if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
        finish();
        return;
      }
      let v = initialVelocity;
      let time = performance.now();
      const tick = (now: number) => {
        const dt = Math.min((now - time) / 1000, 0.032);
        time = now;
        v += ((target - dragRef.current) * 420 - v * 41) * dt;
        const x = dragRef.current + v * dt;
        if (Math.abs(target - x) < 0.5 && Math.abs(v) < 8) {
          finish();
          return;
        }
        setPosition(x);
        animation.current = requestAnimationFrame(tick);
      };
      animation.current = requestAnimationFrame(tick);
    };
    let center: Point = { x: 0, y: 0 };
    const commit = (v: typeof view) => {
      current.current = v;
      setView(v);
    };
    const pair = () => {
      const [a, b] = [...points.values()];
      return {
        distance: Math.hypot(a.x - b.x, a.y - b.y),
        center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      };
    };
    const down = (e: PointerEvent) => {
      if (e.button !== 0) {
        return;
      }
      if ((e.target as HTMLElement).closest("button")) {
        return;
      }
      cancelAnimationFrame(animation.current);
      el.setPointerCapture(e.pointerId);
      points.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (points.size === 1) {
        start = { x: e.clientX, y: e.clientY };
        base = current.current;
        grab = dragRef.current;
        velocity = 0;
        lastMove = performance.now();
        horizontal = Math.abs(grab) > 1;
        startTime = Date.now();
        hadTwo = false;
        moved = false;
      } else if (points.size === 2) {
        hadTwo = true;
        setPosition(0);
        const p = pair();
        distance = p.distance;
        center = p.center;
        base = current.current;
      }
    };
    const move = (e: PointerEvent) => {
      if (!points.has(e.pointerId)) {
        return;
      }
      const prev = points.get(e.pointerId)!;
      points.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (
        Math.hypot(e.clientX - start.x, e.clientY - start.y) > 10 &&
        points.size === 1 &&
        !hadTwo
      ) {
        moved = true;
      }
      if (points.size === 2) {
        const p = pair();
        if (
          Math.abs(p.distance - distance) > 8 ||
          Math.hypot(p.center.x - center.x, p.center.y - center.y) > 8
        ) {
          moved = true;
        }
        const scale = Math.max(
          0.7,
          Math.min(5, (base.scale * p.distance) / Math.max(1, distance)),
        );
        const rect = el.getBoundingClientRect();
        const ox = center.x - rect.left - rect.width / 2;
        const oy = center.y - rect.top - rect.height / 2;
        commit({
          scale,
          x: p.center.x - center.x + ox - ((ox - base.x) * scale) / base.scale,
          y: p.center.y - center.y + oy - ((oy - base.y) * scale) / base.scale,
        });
      } else if (points.size === 1 && current.current.scale > 1 && !hadTwo) {
        commit({
          ...current.current,
          x: current.current.x + e.clientX - prev.x,
          y: current.current.y + e.clientY - prev.y,
        });
      } else if (points.size === 1 && !hadTwo) {
        const dx = e.clientX - start.x;
        const dy = e.clientY - start.y;
        if (
          !horizontal &&
          Math.abs(dx) > 10 &&
          Math.abs(dx) > Math.abs(dy) * 1.3
        ) {
          horizontal = true;
        }
        if (horizontal) {
          const now = performance.now();
          velocity =
            ((e.clientX - prev.x) / Math.max(1, now - lastMove)) * 1000;
          lastMove = now;
          const raw = grab + dx;
          const width = el.clientWidth;
          const x = callbacks.current.canTurn(raw > 0 ? 1 : -1)
            ? Math.max(-width, Math.min(width, raw))
            : (raw * width * 0.35) / (width + 0.35 * Math.abs(raw));
          setPosition(x);
        }
      }
    };
    const up = (e: PointerEvent) => {
      if (!points.has(e.pointerId)) {
        return;
      }
      points.delete(e.pointerId);
      if (points.size) {
        return;
      }
      if (hadTwo) {
        if (!moved && Date.now() - startTime < 320) {
          callbacks.current.onSpread();
        }
        if (current.current.scale <= 1.02) {
          reset();
        }
        return;
      }
      if (current.current.scale > 1) {
        return;
      }
      if (horizontal) {
        const releaseVelocity =
          performance.now() - lastMove > 100 ? 0 : velocity;
        const projected = dragRef.current + releaseVelocity * 0.16;
        const direction = projected > 0 ? 1 : -1;
        const shouldTurn =
          Math.abs(projected) > el.clientWidth * 0.2 &&
          callbacks.current.canTurn(direction);
        settle(
          shouldTurn ? direction * el.clientWidth : 0,
          shouldTurn ? direction : 0,
          releaseVelocity,
        );
        return;
      }
      if (!moved) {
        const rect = el.getBoundingClientRect();
        const x = (e.clientX - rect.left) / rect.width;
        if (x < 0.3) {
          callbacks.current.onTurn(1);
        } else if (x > 0.7) {
          callbacks.current.onTurn(-1);
        } else {
          callbacks.current.onMenu();
        }
      }
    };
    const cancel = () => {
      points.clear();
      reset();
    };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", cancel);
    return () => {
      cancelAnimationFrame(animation.current);
      setPosition(0);
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", cancel);
    };
  }, [ref, enabled]);
  return { view, drag, reset };
}
