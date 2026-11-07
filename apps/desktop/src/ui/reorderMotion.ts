/** The reorder Token in milliseconds: how long rows slide aside and the dragged row settles. */
export const reorderMs = (element: Element) => Number.parseFloat(getComputedStyle(element).getPropertyValue("--duration-reorder"));

export const easingOut = (element: Element = document.documentElement) => getComputedStyle(element).getPropertyValue("--easing-out").trim();

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
