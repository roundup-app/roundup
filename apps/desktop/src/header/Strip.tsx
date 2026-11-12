import type { App as AppCalls } from "../app/seam";
import type { ProjectsState } from "../state/projects";
import type { ProjectAlertLevels } from "../state/projectAlerts";
import { Sortable } from "../ui/sortable";
import { Tabs } from "../ui/Tabs";
import { IconButton } from "../ui/IconButton";
import { copy } from "./copy";
import { createEffect, createMemo, createSignal, For, on, onCleanup, Show } from "solid-js";
import { makeEventListener } from "@solid-primitives/event-listener";
import { LEADER } from "../keys/chords";
import { registerKeys } from "../keys/registry";
import { strandedTabKeys } from "./strandedTabs";
import { CloseDialog } from "./CloseDialog";
import { ProjectTab } from "./ProjectTab";
import { MARKS, markOf, type Mark, type StripTab } from "./tab";
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

/** The close question and the line of Projects waiting for it (U6544b): each closes as its X does; one with running work asks first, and the ones after it wait for their turn. */
const createClosing = (props: { tabs: StripTab[]; onClose: (path: string) => void | Promise<void> }) => {
  const [asking, setAsking] = createSignal<string | null>(null);
  const [closeOpener, setCloseOpener] = createSignal<HTMLElement>();
  let waiting: string[] = [];

  // The question stays the same object until its Project or running work changes, so an unrelated tab update never re-asks it.
  const question = createMemo(() => props.tabs.find((tab) => tab.path === asking()), undefined, { equals: (a, b) => a?.path === b?.path && a?.name === b?.name && JSON.stringify(a?.running) === JSON.stringify(b?.running) });

  const requestClose = (tab: StripTab) => {
    if (asking() !== null) return;

    if (tab.exitText !== null || tab.running.length === 0) props.onClose(tab.path);
    else {
      const active = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;

      // The close X is a pointer target outside the accessibility tree, so focus returns to its tab.
      setCloseOpener(active?.classList.contains("tab-close") ? active.closest<HTMLElement>(".project-tab")?.querySelector<HTMLElement>(".tab-name-button") ?? active : active);
      setAsking(tab.path);
    }
  };

  const next = () => {
    while (asking() === null && waiting.length > 0) {
      const path = waiting.shift();
      const tab = props.tabs.find(each => each.path === path);

      if (tab) requestClose(tab);
    }
  };

  const closeAll = (closing: string[]) => {
    // A Project with no running work closes at once; only the ones with a question wait for their turn.
    waiting = [];

    for (const path of closing) {
      const tab = props.tabs.find(each => each.path === path);

      if (tab && tab.exitText === null && tab.running.length > 0) waiting.push(path);
      else void props.onClose(path);
    }

    next();
  };

  return { asking, setAsking, closeOpener, setCloseOpener, question, requestClose, closeAll, next };
};

/** The header's strip (U179): one tab per open Project in the order the user left them (U6220c), then a quiet `+`. */
export const Strip = (props: {
  tabs: StripTab[];
  active: string | null;
  onSelect: (path: string) => void;
  /** A click on a Tab mark, and leader `⇧J`: that Project opens and its most urgent Agent is selected (U181). */
  onMark: (path: string) => void;
  onRename: (path: string, name: string, base?: string) => ReturnType<ProjectsState["rename"]>;
  onClose: (path: string) => void | Promise<void>;
  /** U6220c: a drag put the tabs in this order. */
  onReorder: (paths: string[]) => void;
  /** U6220d: each Project's alert level, and the menu's way to change it. */
  alerts: ProjectAlertLevels;
  onChoose: () => void;
  /** U2694a: the seam that shows a tab's system menu. */
  app: Pick<AppCalls, "showContextMenu" | "ask" | "writeClipboardText">;
}) => {
  // An edge that says the same thing is not a change: a slot resizes the list only when its cap really appears, changes or goes, so measuring cannot chase its own layout.
  const sameEdge = (a: Edge | null, b: Edge | null) => a === b || (a !== null && b !== null && a.mark === b.mark && a.count === b.count && a.nearest === b.nearest);
  const [left, setLeft] = createSignal<Edge | null>(null, { equals: sameEdge });
  const [right, setRight] = createSignal<Edge | null>(null, { equals: sameEdge });
  // The part of a tab that the list cuts at its start or end, in px (0: no tab is cut there).
  const [cutStart, setCutStart] = createSignal(0);
  const [cutEnd, setCutEnd] = createSignal(0);
  const elements = new Map<string, HTMLElement>();
  let list: HTMLDivElement | undefined;
  const [listElement, setListElement] = createSignal<HTMLDivElement>();
  let observer: ResizeObserver | undefined;

  const { asking, setAsking, closeOpener, setCloseOpener, question, requestClose, closeAll, next } = createClosing(props);

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

  createEffect(() => {
    const mounted = listElement();

    if (typeof ResizeObserver === "undefined" || !mounted) return;
    unrevealed = props.active;

    observer = new ResizeObserver((entries) => {
      // Edge slots resize the list while browsing hidden tabs; only a resized
      // selected tab needs revealing again to keep its recovery action reachable.
      const active = props.active;

      if (active && entries.some((entry) => entry.target === elements.get(active))) unrevealed = active;
      measure();
    });

    observer.observe(mounted);

    for (const element of elements.values()) observer.observe(element);
    onCleanup(() => observer?.disconnect());
  });

  // U186: leader `⇧J` marks the next Project that needs you, or this one; the webview takes it wherever focus is.
  registerKeys({ kind: "leader" }, [{
    action: LEADER["leader.attention-other-project"],
    capture: () => ({ available: () => !asking() && props.tabs.length >= 2 && props.tabs.some((tab) => markOf(tab) !== null),
    invoke: () => {
      if (props.tabs.length < 2) return;

      const at = props.tabs.findIndex((tab) => tab.path === props.active);
      const marked = [...props.tabs.slice(at + 1), ...props.tabs.slice(0, at)].find((tab) => markOf(tab) !== null);

      if (marked) props.onMark(marked.path);
      else if (props.active) props.onMark(props.active);
    } }),
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

  const [tabClicked, setTabClicked] = createSignal(false);
  const noteClick = (click: MouseEvent) => setTabClicked(click.target instanceof Element && click.target.closest(".strip [role=tab]") !== null);

  makeEventListener(document, "click", noteClick, true);
  registerKeys({ kind: "app" }, strandedTabKeys({ paths: () => paths(), clicked: tabClicked, active: () => props.active, focusTab: path => elements.get(path)?.querySelector<HTMLElement>("[role=tab]")?.focus() }));

  return (
    <div class="strip" onFocusIn={(press) => { if (!asking() && press.target === closeOpener()) setCloseOpener(undefined); }}>
      <div class="strip-scroll">
        {edge(copy.left, left())}
        <Tabs.Context>{(tabs) => <Sortable.Root {...tabs().getListProps()} onDrag={undefined} class="tablist app-tabs-list" aria-label={copy.projects} plain horizontal ids={paths()} onOrderChange={(ids) => props.onReorder(ids)} ref={(element) => { list = element; setListElement(element); onCleanup(() => setListElement(undefined)); }} onScroll={measure} style={{ "--cut-start": `${cutStart()}px`, "--cut-end": `${cutEnd()}px` }}>
          <For each={paths()}>
            {(path, at) => {
              // A tab stays the same element while its name, mark or counts change, so focus and hover survive.
              const tab = createMemo<StripTab>((last) => props.tabs.find((each) => each.path === path) ?? last, props.tabs.find((each) => each.path === path)!);

              return (
                <Sortable.Item id={path} index={at()} pressable>{(sort) => <ProjectTab
                  sort={sort}
                  tab={tab()}
                  selected={path === props.active}
                  suppressed={path === props.active}
                  closeFocus={!asking() && closeOpener()?.closest(".project-tab")?.getAttribute("data-path") === path}
                  ref={(element) => {
                    elements.set(path, element);
                    observer?.observe(element);
                    onCleanup(() => {
                      observer?.unobserve(element);
                      elements.delete(path);
                    });
                  }}
                  onMark={() => props.onMark(path)}
                  onRename={(name, base) => props.onRename(path, name, base)}
                  onClose={() => requestClose(tab())}
                  closing={{ others: paths().length > 1 ? () => closeAll(paths().filter(each => each !== path)) : undefined, left: at() > 0 ? () => closeAll(paths().slice(0, at())) : undefined, right: at() < paths().length - 1 ? () => closeAll(paths().slice(at() + 1)) : undefined }}
                  app={props.app}
                  alerts={props.alerts.level(path)}
                  onAlerts={(level) => props.alerts.set(path, level)}
                />}</Sortable.Item>
              );
            }}
          </For>
        </Sortable.Root>}</Tabs.Context>
        {edge(copy.right, right())}
      </div>
      <IconButton data-flat-add="" class="strip-add" aria-label={copy.openAFolder} onClick={() => props.onChoose()}>{copy.addProjectMark}</IconButton>
      <CloseDialog app={props.app} opener={closeOpener()} tab={question()} onCancel={() => { setAsking(null); next(); }} onStop={() => {
        const path = asking();

        if (!path) return;
        setAsking(null);

        const closed = props.onClose(path);

        next();

        return closed;
      }} />
    </div>
  );
};
