import { Portal } from "solid-js/web";
import { createSignal, onCleanup, type Accessor, type JSX } from "solid-js";
import { Tooltip } from "../ui";

type Trigger = () => Omit<JSX.HTMLAttributes<HTMLElement>, "ref" | "children">;

/** U501: the full, unchanged `content` of a truncated or multiline element in the shared Tooltip, on hover and keyboard focus. `children` receives the trigger's props and returns the focusable element. */
export const Tip = (props: { content: string; cut?: Accessor<boolean>; children: (trigger: Trigger) => JSX.Element }) => (
  <Tooltip.Root closeOnEscape={false} disabled={props.cut ? !props.cut() : false} positioning={{ strategy: "fixed", placement: "top-start" }}>
    <Tooltip.Trigger asChild={(trigger) => props.children(trigger)} />
    <Portal><Tooltip.Positioner><Tooltip.Content class="ink-tip">{props.content}</Tooltip.Content></Tooltip.Positioner></Portal>
  </Tooltip.Root>
);

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
