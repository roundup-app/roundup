export type Curve = [number, number, number, number];

/** A `--duration-*` Token in milliseconds, `s` or `ms`; a Token that does not parse gives 0, which lands at once as reduced motion does. */
export const durationMs = (name: string, element: Element = document.documentElement) => {
  const value = getComputedStyle(element).getPropertyValue(name).trim();
  const ms = Number.parseFloat(value) * (value.endsWith("ms") ? 1 : 1000);

  return Number.isFinite(ms) ? ms : 0;
};

/** The reorder Token in milliseconds: how long rows slide aside and the dragged row settles. */
export const reorderMs = (element: Element) => durationMs("--duration-reorder", element);

/** An easing Token's `cubic-bezier(a, b, c, d)` as `[a, b, c, d]`. */
export const curveOf = (name: string, element: Element = document.documentElement): Curve => {
  const [a, b, c, d] = (getComputedStyle(element).getPropertyValue(name).match(/-?[\d.]+/g) ?? []).map(Number);

  return [a ?? Number.NaN, b ?? Number.NaN, c ?? Number.NaN, d ?? Number.NaN];
};

/** `--easing-out` as the CSS string. */
export const easingOut = (element: Element = document.documentElement) => getComputedStyle(element).getPropertyValue("--easing-out").trim();

/** `--easing-out` as its four-number curve, parsed from the same string. */
export const easingOutCurve = (element: Element = document.documentElement) => curveOf("--easing-out", element);

export const translateOf = (element: Element) => {
  const [x = "0", y = "0"] = getComputedStyle(element).translate.split(" ");

  return { x: Number.parseFloat(x) || 0, y: Number.parseFloat(y) || 0 };
};

/** Moves the floating row so its box starts at `to`; resolves once it has arrived. */
export const glide = (element: HTMLElement, to: { x: number; y: number }, duration: number, easing: string) => {
  const rect = element.getBoundingClientRect();
  const from = translateOf(element);
  const target = `${from.x + to.x - rect.x}px ${from.y + to.y - rect.y}px`;

  // Reduced motion lands at once.
  if (!duration) {
    element.style.translate = target;

    return Promise.resolve();
  }

  const animation = element.animate({ translate: [`${from.x}px ${from.y}px`, target] }, { duration, easing, fill: "forwards" });

  return new Promise<void>(resolve => { animation.onfinish = () => resolve(); animation.oncancel = () => resolve(); });
};
