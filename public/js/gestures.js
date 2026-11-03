// Horizontal swipe that follows the finger and leaves vertical scrolling alone.
//
// onMove(dx)          while dragging horizontally
// onEnd(direction,dx) on release: direction is +1 (swiped left → next), -1 (previous) or 0 (cancel)

export function attachSwipe(el, { onMove, onEnd, threshold = 64 }) {
  let start = null; // { x, y, t }
  let locked = null; // 'x' | 'y' | null

  el.addEventListener(
    'touchstart',
    (e) => {
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      start = { x: t.clientX, y: t.clientY, t: performance.now() };
      locked = null;
    },
    { passive: true },
  );

  el.addEventListener(
    'touchmove',
    (e) => {
      if (!start) return;
      const t = e.touches[0];
      const dx = t.clientX - start.x;
      const dy = t.clientY - start.y;
      if (!locked) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        locked = Math.abs(dx) > Math.abs(dy) * 1.2 ? 'x' : 'y';
      }
      if (locked !== 'x') return;
      e.preventDefault(); // we own this gesture now
      onMove?.(dx);
    },
    { passive: false },
  );

  const finish = (e) => {
    if (!start) return;
    if (locked === 'x') {
      const t = e.changedTouches[0];
      const dx = t.clientX - start.x;
      const v = Math.abs(dx) / Math.max(1, performance.now() - start.t); // px/ms
      const fling = Math.abs(dx) > 24 && v > 0.35;
      onEnd?.(Math.abs(dx) > threshold || fling ? (dx < 0 ? 1 : -1) : 0, dx);
    }
    start = null;
    locked = null;
  };
  el.addEventListener('touchend', finish);
  el.addEventListener('touchcancel', (e) => {
    if (locked === 'x') onEnd?.(0, 0);
    start = null;
    locked = null;
  });
}
