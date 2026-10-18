import { activationSource } from "../keys/registry";
import type { ActivationSource } from "../keys/registry";
import { copy } from "../copy";
import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import type { Accessor, JSX } from "solid-js";
import { useTabs } from "@ark-ui/solid/tabs";
import { Tabs } from "../ui/Tabs";
import { ScopeControl } from "./ScopeControl";
import { useShelfScope } from "../todos/shelfScope";
import { ShelfActions } from "./BulkDelete";
import { SectionHead } from "../ink/SectionHead";
import { Pads } from "../pads/Pads";
import { shownPads } from "../pads/shownPads";
import { useConnectedProject } from "../state/connectedProject";
import { Todos } from "../todos/Todos";
import { shownTodos } from "../todos/shownTodos";
import { useTodoList } from "../todos/todoList";
import { usePadList } from "../rail/pads/padList";
import { SHELF_TABS } from "./frame";
import type { ShelfTab, ShelfFrame } from "./frame";
import "./styles.css";

/** U373: one Ark state connects the window bar's triggers to the Shelf's panels. */
export const createShelfTabs = (frame: ShelfFrame) => useTabs(() => ({
  id: "shelf",
  value: frame.tab(),
  ids: { trigger: (tab: string) => `shelf-tab-${tab}`, content: (tab: string) => `shelf-panel-${tab}` },
  onValueChange: ({ value }) => {
    const tab = SHELF_TABS.find(tab => tab.value === value);

    if (tab) frame.setTab(tab.value);
  },
}));

type ShelfTabsProps = { frame: ShelfFrame; onToggle: (source: ActivationSource) => void; counts?: Accessor<Partial<Record<ShelfTab, number>>> };

/** U373: the Shelf controls stay available in the window bar even when its panel is hidden. */
export const ShelfTabs = (props: ShelfTabsProps) => (
  <Tabs.List class="shelf-tabs" aria-label={copy.shelfLabel}>
    <For each={SHELF_TABS}>{(tab) => (
      <Tabs.Trigger value={tab.value} class="shelf-tab"
        aria-selected={props.frame.open() && props.frame.tab() === tab.value}
        aria-expanded={props.frame.open() && props.frame.tab() === tab.value}
        data-open={props.frame.open() && props.frame.tab() === tab.value}
        onPointerDown={(event) => { if (event.button === 0) event.preventDefault(); }}
        onClick={(event) => {
          // Ark's Safari click focus must not take focus back after closing.
          event.preventDefault();

          if (!props.frame.open() || props.frame.tab() === tab.value) props.onToggle(activationSource(event));
          props.frame.setTab(tab.value);

          if (props.frame.open()) event.currentTarget.focus({ preventScroll: true });
        }}
      >
        <SectionHead icon={tab.icon} label={tab.label} />
        <Show when={(props.counts?.()[tab.value] ?? 0) > 0}><span class="shelf-count">{props.counts?.()[tab.value]}</span></Show>
      </Tabs.Trigger>
    )}</For>
  </Tabs.List>
);

/** U373: counts share the lists' existing per-Project readers and scope. */
export const ProjectShelfTabs = (props: ShelfTabsProps) => {
  const connected = useConnectedProject();
  const todos = shownTodos(connected, useTodoList());
  const pads = shownPads(connected, usePadList());
  const counts = createMemo<Partial<Record<ShelfTab, number>>>(() => ({ todos: todos().length, pads: pads().length }));

  return <ShelfTabs {...props} counts={counts} />;
};

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

/** U373: the open tab's list and optional scope control; the tabs live in the window bar. */
export const Shelf = (props: { open: Accessor<boolean> }) => {
  const [actions, setActions] = createSignal<HTMLDivElement>();
  const connected = useConnectedProject();
  const scope = useShelfScope(connected);

  return (
    <>
      <Show when={scope.workstream()}>
        <div class="shelf-bar"><ScopeControl showAll={scope.showAll()} onChange={scope.setShowAll} /></div>
      </Show>
      <ShelfActions.Provider value={{ mount: actions, open: props.open }}>
      <ScrollShadow>
        <For each={SHELF_TABS}>
          {(tab) => (
            <Tabs.Content value={tab.value} class="shelf-panel">
              <Show when={tab.value === "todos"} fallback={<Pads />}>
                <Todos />
              </Show>
            </Tabs.Content>
          )}
        </For>
      </ScrollShadow>
      <div ref={setActions} />
      </ShelfActions.Provider>
    </>
  );
};
