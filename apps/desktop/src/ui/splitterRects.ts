export const rect = (width: number, height = 800) => ({
  x: 0,
  y: 0,
  left: 0,
  top: 0,
  width,
  height,
  right: width,
  bottom: height,
  toJSON() {},
});

/** jsdom has no layout. A panel the Splitter measures with is as wide as it sets it; anything else is the window. */
export function windowRects(this: HTMLElement) {
  return rect(
    this.matches('[data-slot="resizable-panel"]')
      ? parseFloat(this.style.inlineSize)
      : 1280,
  );
}

/** jsdom has no pointer events either: a mouse press the library accepts as primary. */
export class MousePointerEvent extends MouseEvent {
  readonly pointerId = 1;
  readonly pointerType = "mouse";
  readonly isPrimary = true;
}
