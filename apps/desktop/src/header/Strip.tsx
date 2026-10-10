import { createEffect, createMemo, createSignal, For, on, onCleanup, onMount, Show } from "solid-js";
import { CloseDialog } from "./CloseDialog";
import { ProjectTab } from "./ProjectTab";
import { MARKS, markOf } from "./tab";
import type { Mark, StripTab } from "./tab";
import "./strip.styles.css";

type Edge = { mark: Mark; count: number; nearest: string };

/** The marks of the tabs scrolled out of view on one side: the most urgent (`◉` before `●`), how many have one, and the one nearest the visible part (U184). */
const edgeOf = (hidden: StripTab[], nearestFirst: boolean): Edge | null => {
  const marked = hidden.flatMap((tab) => {
    const mark = markOf(tab);

    return mark ? [{ mark, path: tab.path }] : [];
  });

  const nearest = (nearestFirst ? marked[0] : marked.at(-1))?.path;

  if (!nearest) return null;

  return { mark: marked.some((entry) => entry.mark === "error") ? "error" : "needs-you", count: marked.length, nearest };
};

const stepFrom = (tabs: readonly StripTab[], path: string | null, step: 1 | -1): string | undefined => {
  const at = tabs.findIndex((tab) => tab.path === path);

  return tabs[(at + step + tabs.length) % tabs.length]?.path;
};

/** The header's strip (U179): one tab per open Project in the order they were opened, then a quiet `+`. */
export const Strip = (props: {
  tabs: StripTab[];
  active: string | null;
  onSelect: (path: string) => void;
  /** A click on a Tab mark, and `⇧⌘J`: that Project opens and its most urgent Agent is selected (U181). */
  onMark: (path: string) => void;
  onRename: (path: string, name: string) => void;
  onClose: (path: string) => void;
  onChoose: () => void;
}) => {
  const [asking, setAsking] = createSignal<string | null>(null);
  const [left, setLeft] = createSignal<Edge | null>(null);
  const [right, setRight] = createSignal<Edge | null>(null);
  const elements = new Map<string, HTMLElement>();
  let list: HTMLDivElement | undefined;

  const question = createMemo(() => props.tabs.find((tab) => tab.path === asking()));

  const requestClose = (tab: StripTab) => {
    if (tab.exitText !== null || tab.running.length === 0) props.onClose(tab.path);
    else setAsking(tab.path);
  };

  const measure = () => {
    // Without layout (no width) nothing is scrolled out of view.
    if (!list || list.clientWidth === 0) {
      setLeft(null);
      setRight(null);

      return;
    }

    const from = list.scrollLeft;
    const to = from + list.clientWidth;
    const out: Record<"left" | "right", StripTab[]> = { left: [], right: [] };

    for (const tab of props.tabs) {
      const element = elements.get(tab.path);

      if (!element) continue;

      if (element.offsetLeft + element.offsetWidth <= from) out.left.push(tab);
      else if (element.offsetLeft >= to) out.right.push(tab);
    }

    setLeft(edgeOf(out.left, false));
    setRight(edgeOf(out.right, true));
  };

  const reveal = (path: string) => list && list.scrollWidth > list.clientWidth && elements.get(path)?.scrollIntoView({ inline: "nearest", block: "nearest" });

  const paths = createMemo(() => props.tabs.map((tab) => tab.path), [], { equals: (a, b) => a.length === b.length && a.every((path, at) => path === b[at]) });

  const layoutKey = createMemo(() => props.tabs.map((tab) => `${tab.path}:${markOf(tab)}`).join());

  createEffect(on(layoutKey, measure));

  createEffect(on(() => props.active, (path) => path && queueMicrotask(() => reveal(path)), { defer: true }));

  onMount(() => {
    if (typeof ResizeObserver === "undefined" || !list) return;

    const observer = new ResizeObserver(measure);

    observer.observe(list);
    onCleanup(() => observer.disconnect());
  });

  // U186: `⇧⌘]`, `⇧⌘[` and `⇧⌘J` by key position, so Caps Lock and the layout do not matter; the webview takes them wherever focus is.
  const onKey = (press: KeyboardEvent) => {
    if (!press.metaKey || !press.shiftKey || press.ctrlKey || press.altKey) return;

    if (press.target instanceof Element && press.target.closest(".tab-rename")) return;

    const step = press.code === "BracketRight" ? 1 : press.code === "BracketLeft" ? -1 : 0;

    if (step === 0 && press.code !== "KeyJ") return;

    press.preventDefault();
    press.stopPropagation();

    if (press.repeat || props.tabs.length < 2) return;

    if (step !== 0) {
      const next = stepFrom(props.tabs, props.active, step);

      if (next) props.onSelect(next);

      return;
    }

    const at = props.tabs.findIndex((tab) => tab.path === props.active);
    const marked = [...props.tabs.slice(at + 1), ...props.tabs.slice(0, at)].find((tab) => markOf(tab) !== null);

    if (marked) props.onMark(marked.path);
    else if (props.active) props.onMark(props.active);
  };

  // Document capture, after Help's window capture: while Help is open these chords do nothing.
  document.addEventListener("keydown", onKey, true);
  onCleanup(() => document.removeEventListener("keydown", onKey, true));

  const edge = (side: "left" | "right", shown: Edge | null) => (
    <Show when={shown}>
      {(hidden) => (
        <button
          type="button"
          class={`strip-edge strip-edge-${side} ink`}
          data-tone={MARKS[hidden().mark].tone}
          aria-label={`${hidden().count} ${MARKS[hidden().mark].label} to the ${side}`}
          onClick={() => reveal(hidden().nearest)}
        >
          {side === "left" ? "◂ " : ""}
          {MARKS[hidden().mark].character}
          {hidden().count > 1 ? ` ${hidden().count}` : ""}
          {side === "right" ? " ▸" : ""}
        </button>
      )}
    </Show>
  );

  return (
    <div class="strip">
      <div class="strip-scroll">
        {edge("left", left())}
        <div class="tablist" role="tablist" aria-label="projects" ref={(element) => (list = element)} onScroll={measure}>
          <For each={paths()}>
            {(path) => {
              // A tab stays the same element while its name, mark or counts change, so focus and hover survive.
              const tab = createMemo<StripTab>((last) => props.tabs.find((each) => each.path === path) ?? last, props.tabs.find((each) => each.path === path)!);

              return (
                <ProjectTab
                  tab={tab()}
                  selected={path === props.active}
                  ref={(element) => {
                    elements.set(path, element);
                    onCleanup(() => elements.delete(path));
                  }}
                  onSelect={() => props.onSelect(path)}
                  onMark={() => props.onMark(path)}
                  onRename={(name) => props.onRename(path, name)}
                  onClose={() => requestClose(tab())}
                />
              );
            }}
          </For>
        </div>
        {edge("right", right())}
      </div>
      <button type="button" class="word strip-add" aria-label="open a folder" onClick={() => props.onChoose()}>
        +
      </button>
      <Show when={question()}>
        {(asked) => <CloseDialog tab={asked()} onCancel={() => setAsking(null)} onStop={() => {
          const path = asked().path;

          setAsking(null);
          props.onClose(path);
        }} />}
      </Show>
    </div>
  );
};
