/** U2228b: show `text` in `box`, cut in the middle with one `…` when it overflows, keeping its start and end. */
export const middleCut = (box: HTMLElement, text: string) => {
  box.textContent = text;

  if (box.scrollWidth <= box.clientWidth) return;

  const at = (kept: number) => `${text.slice(0, Math.ceil(kept / 2))}…${text.slice(text.length - Math.floor(kept / 2))}`;
  let fits = 0;
  let over = text.length;

  while (over - fits > 1) {
    const mid = (fits + over) >> 1;
    box.textContent = at(mid);

    if (box.scrollWidth <= box.clientWidth) fits = mid;
    else over = mid;
  }

  box.textContent = at(fits);
};
