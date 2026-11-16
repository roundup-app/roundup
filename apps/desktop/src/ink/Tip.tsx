import { createMemo, createSignal, onCleanup, type Accessor } from "solid-js";

/** U501: whether an element's text is cut, by width or height or by a line break in `lines`; `ref` goes on the element that clips. Tips of whole labels stay off. */
export const createCut = (lines?: Accessor<string>): [(element: HTMLElement) => void, Accessor<boolean>] => {
  const [overflows, setOverflows] = createSignal(false);
  const broken = createMemo(() => /[\r\n]/.test(lines?.() ?? ""));
  const releases: (() => void)[] = [];

  onCleanup(() => { for (const release of releases) release(); });

  const ref = (element: HTMLElement) => {
    const measure = () => setOverflows(element.scrollWidth > element.clientWidth || element.scrollHeight > element.clientHeight);
    const resize = new ResizeObserver(measure);
    const text = new MutationObserver(measure);

    resize.observe(element);
    text.observe(element, { childList: true, characterData: true, subtree: true });
    measure();
    releases.push(() => { resize.disconnect(); text.disconnect(); });
  };

  const cut = createMemo(() => overflows() || broken());

  return [ref, cut];
};
