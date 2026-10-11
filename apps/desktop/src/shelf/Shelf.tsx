import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import type { Accessor, JSX } from "solid-js";
import { Icon } from "../ink/Icon";
import { Pads } from "../pads/Pads";
import { shownPads } from "../pads/shownPads";
import { useConnectedProject } from "../state/connectedProject";
import { Todos } from "../todos/Todos";
import { shownTodos } from "../todos/shownTodos";
import { useTodoList } from "../todos/todoList";
import { usePadList } from "../rail/pads/padList";
import { SHELF_TABS } from "./frame";
import type { ShelfTab } from "./frame";
import "./styles.css";

const LABELS: Record<ShelfTab, string> = { todos: "Todos", pads: "Pads" };

/** U370: the one button that hides and shows the Shelf; it sits in the Shelf's tablist line while open and at the header's trailing edge while closed. */
export const ShelfToggle = (props: { open: boolean; onToggle: () => void }) => (
  <button
    data-button="icon"
    type="button"
    class="shelf-toggle"
    aria-label={props.open ? "hide Shelf" : "show Shelf"}
    aria-expanded={props.open}
    onClick={() => props.onToggle()}
  >
    <Icon name={props.open ? "right" : "left"} />
  </button>
);

/** U371: a scroll shadow shows on an edge only where content is clipped there. */
const ScrollShadow = (props: { children: JSX.Element }) => {
  const [top, setTop] = createSignal(false);
  const [bottom, setBottom] = createSignal(false);
  let area: HTMLDivElement | undefined;

  const measure = () => {
    if (!area) return;

    setTop(area.scrollTop > 0);
    setBottom(area.scrollTop + area.clientHeight < area.scrollHeight - 1);
  };

  onMount(() => {
    measure();

    if (typeof ResizeObserver === "undefined" || !area) return;

    const observer = new ResizeObserver(measure);

    observer.observe(area);

    for (const child of area.children) observer.observe(child);

    onCleanup(() => observer.disconnect());
  });

  return (
    <div class="shelf-scroll" data-clipped-top={top()} data-clipped-bottom={bottom()}>
      <div class="shelf-area" ref={(element) => (area = element)} onScroll={measure}>
        {props.children}
      </div>
    </div>
  );
};

/** U373: a tablist of `Todos` and `Pads` with a quiet count each, and the open tab's list as the only panel. */
export const Shelf = (props: { tab: Accessor<ShelfTab>; onTab: (tab: ShelfTab) => void; onHide: () => void }) => {
  const connected = useConnectedProject();
  const todos = useTodoList();
  const pads = usePadList();
  const openTodos = shownTodos(connected, todos);
  const shown = shownPads(connected, pads);
  const counts = createMemo<Record<ShelfTab, number>>(() => ({ todos: openTodos().length, pads: shown().length }));
  const tabs = new Map<ShelfTab, HTMLButtonElement>();

  const select = (tab: ShelfTab, focus: boolean) => {
    props.onTab(tab);

    if (focus) queueMicrotask(() => tabs.get(tab)?.focus());
  };

  const onKey = (press: KeyboardEvent, tab: ShelfTab) => {
    if (press.metaKey || press.ctrlKey || press.altKey || press.shiftKey) return;

    const at = SHELF_TABS.indexOf(tab);

    const to =
      press.key === "ArrowRight" ? SHELF_TABS[(at + 1) % SHELF_TABS.length]
      : press.key === "ArrowLeft" ? SHELF_TABS[(at + SHELF_TABS.length - 1) % SHELF_TABS.length]
      : press.key === "Home" ? SHELF_TABS[0]
      : press.key === "End" ? SHELF_TABS.at(-1)
      : undefined;

    if (!to) return;

    press.preventDefault();
    select(to, true);
  };

  return (
    <>
      <div class="shelf-bar">
        <div class="shelf-tabs" role="tablist" aria-label="shelf">
          <For each={SHELF_TABS}>
            {(tab) => (
              <button
                data-button="quiet"
                type="button"
                role="tab"
                id={`shelf-tab-${tab}`}
                class="shelf-tab"
                aria-selected={props.tab() === tab}
                aria-controls="shelf-panel"
                tabIndex={props.tab() === tab ? 0 : -1}
                ref={(element) => tabs.set(tab, element)}
                onClick={() => select(tab, false)}
                onKeyDown={(press) => onKey(press, tab)}
              >
                {LABELS[tab]}
                <Show when={counts()[tab] > 0}>
                  <span class="shelf-count">{counts()[tab]}</span>
                </Show>
              </button>
            )}
          </For>
        </div>
        <ShelfToggle open onToggle={props.onHide} />
      </div>
      <ScrollShadow>
        <div role="tabpanel" id="shelf-panel" aria-labelledby={`shelf-tab-${props.tab()}`} class="shelf-panel">
          <Show when={props.tab() === "todos"} fallback={<Pads />}>
            <Todos />
          </Show>
        </div>
      </ScrollShadow>
    </>
  );
};
