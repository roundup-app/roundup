import { Tabs, IconButton, FlatAdd, FlatBar } from "../ui";
import { registerKeys } from "../keys/registry";
import { chordsFor } from "../keys/chords";
import { copy } from "../copy";
import { createEffect, createMemo, createSignal, For, on, onCleanup, onMount, Show } from "solid-js";
import { CloseDialog } from "./CloseDialog";
import { ProjectTab } from "./ProjectTab";
import { MARKS, markOf } from "./tab";
import type { Mark, StripTab } from "./tab";
import "./strip.styles.css";

type Edge = { mark: Mark; count: number; nearest: string };

/** The marks of the tabs scrolled out of view on one side: the most urgent (error before needs-you), how many have one, and the one nearest the visible part (U184). */
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
  /** U377: `Models` in a tab's menu opens that Project's `Models` sheet. */
  onModels: (path: string) => void;
}) => {
  const [asking, setAsking] = createSignal<string | null>(null);
  // An edge that says the same thing is not a change: a slot resizes the list only when its cap really appears, changes or goes, so measuring cannot chase its own layout.
  const sameEdge = (a: Edge | null, b: Edge | null) => a === b || (a !== null && b !== null && a.mark === b.mark && a.count === b.count && a.nearest === b.nearest);
  const [left, setLeft] = createSignal<Edge | null>(null, { equals: sameEdge });
  const [right, setRight] = createSignal<Edge | null>(null, { equals: sameEdge });
  // The part of a tab that the list cuts at its start or end, in px (0: no tab is cut there).
  const [cutStart, setCutStart] = createSignal(0);
  const [cutEnd, setCutEnd] = createSignal(0);
  const elements = new Map<string, HTMLElement>();
  let list: HTMLDivElement | undefined;
  const [closeOpener, setCloseOpener] = createSignal<HTMLElement>();

  const question = createMemo(() => props.tabs.find((tab) => tab.path === asking()));

  const requestClose = (tab: StripTab) => {
    if (tab.exitText !== null || tab.running.length === 0) props.onClose(tab.path);
    else {
      setCloseOpener(document.activeElement instanceof HTMLElement ? document.activeElement : undefined);
      setAsking(tab.path);
    }
  };

  let settling = 0;
  let flips = 0;

  const measure = () => {
    // Without layout (no width) nothing is scrolled out of view.
    if (!list || list.clientWidth === 0) {
      setLeft(null);
      setRight(null);
      setCutStart(0);
      setCutEnd(0);

      return;
    }

    const frame = list.getBoundingClientRect();
    const from = list.scrollLeft;
    const to = from + list.clientWidth;
    const out: Record<"left" | "right", StripTab[]> = { left: [], right: [] };

    let startPiece = 0;
    let endPiece = 0;
    let activeCut = false;

    for (const tab of props.tabs) {
      const element = elements.get(tab.path);

      if (!element) continue;

      const near = element.offsetLeft;
      const far = near + element.offsetWidth;

      // The open tab is never covered: where the list is barely wider than one tab, covering its cut would hide the only tab in view.
      const open = tab.path === props.active;

      // The cover is exactly the piece that shows: fractional layout, so it neither leaves a sliver of the cut tab's border nor reaches the next tab's.
      const box = element.getBoundingClientRect();

      if (near < from && far > from && !open) startPiece = box.right - frame.left;

      if (near < to && far > to && !open) endPiece = frame.right - box.left;

      if (tab.path === props.active && ((near < from && far > from) || (near < to && far > to))) activeCut = true;

      if (element.offsetLeft + element.offsetWidth <= from) out.left.push(tab);
      else if (element.offsetLeft >= to) out.right.push(tab);
    }

    const nextLeft = edgeOf(out.left, false);
    const nextRight = edgeOf(out.right, true);
    const slotsChanged = (left() === null) !== (nextLeft === null) || (right() === null) !== (nextRight === null);

    // A slot that appears narrows the list under the open tab, so the next two measures bring that tab back into view; a few flips at most per open tab.
    if (settling > 0) {
      settling -= 1;

      if (activeCut && props.active) unrevealed = props.active;
    }

    if (slotsChanged && flips < 4) {
      flips += 1;
      settling = 2;
    }

    setCutStart(startPiece);
    setCutEnd(endPiece);
    setLeft(nextLeft);
    setRight(nextRight);
    revealOpen();
  };

  const reveal = (path: string) => {
    const element = elements.get(path);

    if (!list || !element || list.scrollWidth <= list.clientWidth) return;

    element.scrollIntoView({ inline: "nearest", block: "nearest" });

    // The scroll offset rounds to whole pixels while layout does not: a revealed tab's start never ends a fraction short of the list, and its end only gives way when the tab cannot fit.
    const frame = list.getBoundingClientRect();
    const box = element.getBoundingClientRect();

    if (box.left < frame.left) list.scrollLeft -= Math.ceil(frame.left - box.left);
    else if (box.right > frame.right && box.width <= frame.width) list.scrollLeft += Math.ceil(box.right - frame.right);
  };

  // The open tab is revealed once the strip has a width and the tab an element, so a tab opened before the first layout (a restart, U186) is not left out of view.
  let unrevealed: string | null = null;

  const revealOpen = () => {
    if (!unrevealed || !list || list.clientWidth === 0 || !elements.has(unrevealed)) return;

    reveal(unrevealed);
    unrevealed = null;
  };

  const paths = createMemo(() => props.tabs.map((tab) => tab.path), [], { equals: (a, b) => a.length === b.length && a.every((path, at) => path === b[at]) });

  const layoutKey = createMemo(() => props.tabs.map((tab) => `${tab.path}:${markOf(tab)}`).join());

  createEffect(on(layoutKey, measure));

  createEffect(on(() => props.active, (path) => {
    flips = 0;
    unrevealed = path;
    queueMicrotask(revealOpen);
  }));

  onMount(() => {
    if (typeof ResizeObserver === "undefined" || !list) return;

    const observer = new ResizeObserver(measure);

    observer.observe(list);
    onCleanup(() => observer.disconnect());
  });

  // U186: `⇧⌘]`, `⇧⌘[` and `⇧⌘J` by key position, so Caps Lock and the layout do not matter; the webview takes them wherever focus is.
  const onKey = (press: KeyboardEvent) => {
    if (asking()) return;

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

  registerKeys({ kind: "app" }, [{
    chords: [...chordsFor("⇧⌘]"), ...chordsFor("⇧⌘["), ...chordsFor("⇧⌘J")],
    when: (press) => !asking() && !(press.target instanceof Element && press.target.closest('.tab-rename')),
    run: onKey,
  }]);

  const edge = (side: "left" | "right", shown: Edge | null) => (
    <Show when={shown}>
      {(hidden) => (
        <div class="strip-slot" data-side={side}>
          <IconButton
            class={`strip-edge strip-edge-${side} ink`}
            data-tone={MARKS[hidden().mark].tone}
            data-kind={hidden().mark}
            aria-label={copy.hiddenAttention(hidden().count, MARKS[hidden().mark].label.toLowerCase(), side)}
            onClick={() => reveal(hidden().nearest)}
          >
            {side === "left" ? copy.previousProjectsMark : ""}
            <span class="tab-mark ink" data-tone={MARKS[hidden().mark].tone} aria-hidden="true" />
            {hidden().count > 1 ? ` ${hidden().count}` : ""}
            {side === "right" ? copy.nextProjectsMark : ""}
          </IconButton>
        </div>
      )}
    </Show>
  );

  return (
    <FlatBar class="strip" onFocusIn={(press) => {
      if (!asking() && press.target === closeOpener()) setCloseOpener(undefined);
    }}>
      <div class="strip-scroll">
        {edge(copy.left, left())}
        <Tabs.List class="tablist" aria-label={copy.projects} ref={(element) => (list = element)} onScroll={measure} style={{ "--cut-start": `${cutStart()}px`, "--cut-end": `${cutEnd()}px` }}>
          <For each={paths()}>
            {(path) => {
              // A tab stays the same element while its name, mark or counts change, so focus and hover survive.
              const tab = createMemo<StripTab>((last) => props.tabs.find((each) => each.path === path) ?? last, props.tabs.find((each) => each.path === path)!);

              return (
                <ProjectTab
                  tab={tab()}
                  selected={path === props.active}
                  closeFocus={!asking() && closeOpener()?.closest(".project-tab")?.getAttribute("data-path") === path}
                  ref={(element) => {
                    elements.set(path, element);
                    onCleanup(() => elements.delete(path));
                  }}
                  onMark={() => props.onMark(path)}
                  onRename={(name) => props.onRename(path, name)}
                  onClose={() => requestClose(tab())}
                  onModels={() => props.onModels(path)}
                />
              );
            }}
          </For>
        </Tabs.List>
        {edge(copy.right, right())}
      </div>
      <FlatAdd data-button="icon" class="word strip-add" aria-label={copy.openAFolder} onClick={() => props.onChoose()}>{copy.addProjectMark}</FlatAdd>
      <CloseDialog opener={closeOpener()} tab={question()} onCancel={() => setAsking(null)} onStop={() => {
        const path = asking();

        if (!path) return;
        setAsking(null);
        props.onClose(path);
      }} />
    </FlatBar>
  );
};
