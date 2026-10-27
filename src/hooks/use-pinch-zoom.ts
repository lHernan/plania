import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { clampPan, DOUBLE_TAP_ZOOM, zoomAt, type Point, type Size, type ZoomState } from "@/lib/documents/geometry";

const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_SLOP_PX = 30;
/** Moving less than this between down and up still counts as a tap. */
const TAP_SLOP_PX = 8;

/**
 * Pinch to zoom, drag to pan (also scrolls the page column when not zoomed), double tap to
 * zoom in/out, ctrl/⌘ + wheel to zoom and wheel to scroll on desktop. The content is drawn with
 * `transform: translate(x, y) scale(scale)` from its top-left corner.
 */
export function usePinchZoom(containerRef: RefObject<HTMLElement | null>, content: Size) {
  const [state, setState] = useState<ZoomState>({ scale: 1, x: 0, y: 0 });
  const pointers = useRef(new Map<number, Point>());
  const lastTap = useRef<{ at: number; point: Point } | null>(null);
  const travel = useRef(0);
  const contentRef = useRef(content);
  useEffect(() => {
    contentRef.current = content;
  });

  const containerSize = useCallback((): Size => {
    const rect = containerRef.current?.getBoundingClientRect();
    return { width: rect?.width ?? 0, height: rect?.height ?? 0 };
  }, [containerRef]);

  const apply = useCallback(
    (next: (current: ZoomState) => ZoomState) => setState((current) => clampPan(next(current), containerSize(), contentRef.current)),
    [containerSize],
  );

  // A new document (or a resize) starts fitted and centered.
  useEffect(() => {
    apply(() => ({ scale: 1, x: 0, y: 0 }));
  }, [apply, content.width, content.height]);

  const local = (event: { clientX: number; clientY: number }): Point => {
    const rect = containerRef.current?.getBoundingClientRect();
    return { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) };
  };

  // The pointer is captured only once a gesture starts: capturing on pointerdown would send
  // the following click to the container instead of a highlighted code under the finger.
  const capture = (event: ReactPointerEvent) => {
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      // The pointer may already be gone.
    }
  };

  const onPointerDown = (event: ReactPointerEvent) => {
    pointers.current.set(event.pointerId, local(event));
    if (pointers.current.size > 1) capture(event);
    if (pointers.current.size === 1) travel.current = 0;
  };

  const onPointerMove = (event: ReactPointerEvent) => {
    const previous = pointers.current.get(event.pointerId);
    if (!previous) return;
    const point = local(event);
    const others = [...pointers.current.entries()].filter(([id]) => id !== event.pointerId).map(([, p]) => p);
    pointers.current.set(event.pointerId, point);
    const wasTap = travel.current <= TAP_SLOP_PX;
    travel.current += Math.hypot(point.x - previous.x, point.y - previous.y);
    if (wasTap && travel.current > TAP_SLOP_PX) capture(event);

    if (others.length === 1) {
      const other = others[0];
      const before = Math.hypot(previous.x - other.x, previous.y - other.y);
      const after = Math.hypot(point.x - other.x, point.y - other.y);
      const midBefore = { x: (previous.x + other.x) / 2, y: (previous.y + other.y) / 2 };
      const midAfter = { x: (point.x + other.x) / 2, y: (point.y + other.y) / 2 };
      apply((current) => {
        const zoomed = before > 0 ? zoomAt(current, after / before, midBefore) : current;
        return { ...zoomed, x: zoomed.x + midAfter.x - midBefore.x, y: zoomed.y + midAfter.y - midBefore.y };
      });
    } else if (others.length === 0) {
      apply((current) => ({ ...current, x: current.x + point.x - previous.x, y: current.y + point.y - previous.y }));
    }
  };

  const onPointerUp = (event: ReactPointerEvent) => {
    const point = pointers.current.get(event.pointerId) ?? local(event);
    pointers.current.delete(event.pointerId);
    if (pointers.current.size > 0 || travel.current > TAP_SLOP_PX) return;
    const now = Date.now();
    const last = lastTap.current;
    if (last && now - last.at < DOUBLE_TAP_MS && Math.hypot(point.x - last.point.x, point.y - last.point.y) < DOUBLE_TAP_SLOP_PX) {
      lastTap.current = null;
      apply((current) => (current.scale > 1 ? { scale: 1, x: 0, y: 0 } : zoomAt(current, DOUBLE_TAP_ZOOM, point)));
    } else {
      lastTap.current = { at: now, point };
    }
  };

  // Wheel listeners must be non-passive to stop the page from scrolling behind the viewer.
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const point = local(event);
      if (event.ctrlKey || event.metaKey) apply((current) => zoomAt(current, Math.exp(-event.deltaY * 0.01), point));
      else apply((current) => ({ ...current, x: current.x - event.deltaX, y: current.y - event.deltaY }));
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- local() only reads the ref
  }, [apply, containerRef]);

  /** True right after a drag or pinch, so taps on highlighted codes are not fired by accident. */
  const wasGesture = () => travel.current > TAP_SLOP_PX;

  return {
    state,
    reset: () => apply(() => ({ scale: 1, x: 0, y: 0 })),
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp },
    wasGesture,
  };
}
