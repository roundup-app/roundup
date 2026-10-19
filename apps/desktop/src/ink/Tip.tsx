import { createSignal, onCleanup, type Accessor } from "solid-js";

/** U501: whether an element's text is cut, by width or height or by a line break in `lines`; `ref` goes on the element that clips. Tips of whole labels stay off. */
export const createCut = (lines?: Accessor<string>): [(element: HTMLElement) => void, Accessor<boolean>] => {
  const [cut, setCut] = createSignal(false);

  const ref = (element: HTMLElement) => {
    const measure = () => setCut(element.scrollWidth > element.clientWidth || element.scrollHeight > element.clientHeight || /[\r\n]/.test(lines?.() ?? ""));
    const resize = new ResizeObserver(measure);
    const text = new MutationObserver(measure);

    resize.observe(element);
    text.observe(element, { childList: true, characterData: true, subtree: true });
    measure();
    onCleanup(() => { resize.disconnect(); text.disconnect(); });
  };

  return [ref, cut];
};
