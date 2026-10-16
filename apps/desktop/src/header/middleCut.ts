/** U2228b: show `text` in `box`, cut in the middle with one `…` when it overflows, keeping its start and end. Cuts fall between grapheme clusters, never inside an emoji. */
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

export const middleCut = (box: HTMLElement, text: string) => {
  box.textContent = text;

  if (box.scrollWidth <= box.clientWidth) return;

  const parts = Array.from(graphemes.segment(text), (part) => part.segment);
  const at = (kept: number) => `${parts.slice(0, Math.ceil(kept / 2)).join("")}…${parts.slice(parts.length - Math.floor(kept / 2)).join("")}`;
  let fits = 0;
  let over = parts.length;

  while (over - fits > 1) {
    const mid = (fits + over) >> 1;
    box.textContent = at(mid);

    if (box.scrollWidth <= box.clientWidth) fits = mid;
    else over = mid;
  }

  box.textContent = at(fits);
};
