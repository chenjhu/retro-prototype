// An iOS-style scroll wheel: a column that snaps one row into the centre band, with
// rows fading and curving away from the centre like a drum.
//
//   const w = createWheel(el, { onSettle: (value) => … });
//   w.setValues([1, 2, 3], (v) => `W${v}`);   w.setValue(2);   w.value

export const ROW = 34; // px; must match .wheel-item height in style.css

export function createWheel(el, { onSettle } = {}) {
  let values = [];
  let settleTimer = null;
  let frame = null;

  const track = document.createElement('div');
  track.className = 'wheel-track';
  el.append(track);

  const index = () => Math.max(0, Math.min(values.length - 1, Math.round(el.scrollTop / ROW)));

  function paint() {
    frame = null;
    const centre = el.scrollTop / ROW;
    for (const item of track.children) {
      const d = Number(item.dataset.i) - centre;
      const a = Math.min(Math.abs(d), 3);
      item.style.opacity = String(Math.max(0, 1 - a * 0.36));
      item.style.transform = `rotateX(${(-d * 22).toFixed(1)}deg) scale(${(1 - a * 0.045).toFixed(3)})`;
      item.classList.toggle('on', Math.abs(d) < 0.5);
    }
  }

  el.addEventListener(
    'scroll',
    () => {
      frame ??= requestAnimationFrame(paint);
      clearTimeout(settleTimer);
      // Momentum scrolling keeps firing; act once it has come to rest.
      settleTimer = setTimeout(() => {
        settleTimer = null;
        onSettle?.(values[index()]);
      }, 140);
    },
    { passive: true },
  );

  // Tapping a row scrolls it into the centre, like the native picker.
  track.addEventListener('click', (e) => {
    const item = e.target.closest('.wheel-item');
    if (item) el.scrollTo({ top: Number(item.dataset.i) * ROW, behavior: 'smooth' });
  });

  return {
    setValues(list, format = String) {
      const keep = values[index()];
      values = list;
      track.replaceChildren(
        ...list.map((v, i) => {
          const d = document.createElement('div');
          d.className = 'wheel-item';
          d.dataset.i = i;
          d.textContent = format(v);
          return d;
        }),
      );
      if (keep !== undefined && list.includes(keep)) el.scrollTop = list.indexOf(keep) * ROW;
      paint();
    },
    setValue(v) {
      const i = values.indexOf(v);
      if (i < 0 || i === index()) return;
      el.scrollTop = i * ROW;
      paint();
    },
    get value() {
      return values[index()];
    },
    /** True while the wheel is moving under the user's finger or settling. */
    get busy() {
      return settleTimer !== null;
    },
    paint,
  };
}
