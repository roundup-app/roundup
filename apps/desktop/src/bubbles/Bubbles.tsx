import { writeText } from "../app/clipboard";
import { ReservedLine } from "../ink/ReservedLine";
import { CHORDS, LEADER } from "../keys/chords";
import { registerKeys } from "../keys/registry";
import * as v from "valibot";
import { Dialog } from "../ui/Dialog";
import { Editable } from "../ui/Editable";
import { FlatAdd, FlatTab } from "../ui/FlatTab";
import { IconButton } from "../ui/IconButton";
import { contextMenu, linkEntries, openOnRelease, textTarget, PULL_DISTANCE } from "../ui/contextMenu";
import { Panel } from "../ui/Panel";
import { copy } from "../copy";
import { createEffect, createMemo, createSignal, For, on, onCleanup, onMount, Show, untrack } from "solid-js";
import { Portal } from "solid-js/web";
import type { TerminalInfo } from "@contracts/terminal/TerminalInfo";
import { Icon } from "../ink/Icon";
import { createCut } from "../ink/Tip";
import { Tip } from "../ui/Tip";
import { isWorkstream, resolvedWorkstream, siblingsOf } from "../rail/layout";
import { useConnectedProject } from "../state/connectedProject";
import type { Screens } from "../terminal/screens";
import {
  clamped, defaultPlace, FALLBACK_EXTENT, placesStorage, resizedAbout, REVEAL_BUBBLE, shownFor, shownName, STEP, toggledFill, zoneBox, ZONES,
} from "./places";
import type { Place, Extent, Zone } from "./places";
import "./styles.css";

/** U421 engineering call 1: past the 3 to 4 px a hand wobbles while it clicks. */

const focusPane = (): void => {
  const target = document.querySelector<HTMLElement>(".pane-screen textarea, .pane-screen [tabindex]");

  target?.focus();

  if (document.activeElement !== target) document.querySelector<HTMLElement>(".terminal-new")?.focus();
};

const ESCAPE = "Escape".split(" ");

const SHIFT = "Shift+".split(" ")[0]!;

const ARROWS = new Map<string, [number, number]>(Object.entries({ ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }));

/** U469: the selected Terminals, their Bubble geometry, bottom tabs and opening/cycling chords. */
export const Bubbles = (props: {
  screens: Screens;
  /** Open only this Project's original, non-pending revision in a shown Terminal tab.
   * Refuse foreign/unavailable work; restore never sends or retries storage.
   */
  recovery?: { project: string; revision: string } | undefined;
}) => {
  const connected = useConnectedProject();
  const { rail, app } = connected;
  const path = connected.project.path;
  const store = placesStorage(path);
  const drafts = connected.drafts;
  const schema = v.strictObject({ name: v.string(), base: v.string(), recovery: v.optional(v.literal(true)) });
  drafts.validate("bubbles", schema);
  drafts.registerRecovery("bubbles", (draft, facts) => {
    return facts.daemonExit() !== null ? "unavailable" : facts.rail.failure() ? "unverified"
      : facts.rail.terminals().some(terminal => terminal.incarnation === draft.destination.object && terminal.id === draft.destination.recipient && terminal.running) ? "available" : "unavailable";
  });
  const records = createMemo(() => drafts.list().filter(draft => draft.destination.surface === "bubbles"));
  const [recovering, recover] = createSignal(false);
  const [inspected, inspect] = createSignal<string>();
  const [copyFailure, failCopy] = createSignal<string | null>(null);
  const shownDraft = () => records().find(draft => draft.revision === inspected()) ?? records().filter(draft => draft.status === "draft" && !draft.value.recovery).at(-1) ?? records().at(-1);

  const problem = () => {
    const failure = drafts.problem();

    return failure?.destination && failure.destination.surface !== "bubbles" ? null : failure;
  };

  const original = (draft: ReturnType<typeof drafts.list>[number]) => rail.terminals().find(terminal => terminal.incarnation === draft.destination.object && terminal.id === draft.destination.recipient && terminal.running);

  const copyName = async () => {
    const draft = shownDraft();
    const parsed = draft && v.safeParse(schema, draft.value);

    if (!parsed?.success) return;

    try { await writeText(connected.app, parsed.output.name); failCopy(null); }
    catch (error) { failCopy(copy.copyDraftFailure(error instanceof Error ? error.message : String(error))); }
  };

  let recoveryPanel: HTMLDivElement | undefined;
  registerKeys({ kind: "layer", element: () => recoveryPanel, active: recovering, modal: true }, []);

  const refreshPlaces = (event: StorageEvent) => {
    if (event.storageArea === window.sessionStorage && event.key === `roundup:bubble-places:${path}`) setPlaces(store.read());
  };

  window.addEventListener("storage", refreshPlaces);
  onCleanup(() => window.removeEventListener("storage", refreshPlaces));

  const persistPlaces = (value: Record<string, Place>): void => {
    if (connected.daemonExit() === null) store.write(value);
  };

  const [places, setPlaces] = createSignal<Record<string, Place>>(store.read());
  const [failure, setFailure] = createSignal<string | null>(null);
  const [opening, setOpening] = createSignal(false);
  const [wanted, setWanted] = createSignal<string | null>(null);
  const [layer, setLayer] = createSignal<HTMLElement>();
  const [bar, setBar] = createSignal<HTMLElement>();
  const [measured, setMeasured] = createSignal(false);
  const [origin, setOrigin] = createSignal({ left: 0, top: 0, width: 0, height: 0 });
  const [editing, setEditing] = createSignal<{ id: string } | null>(null);
  createEffect(on(() => rail.selected(), () => setEditing(null), { defer: true }));
  onMount(() => setBar(layer()?.parentElement?.querySelector<HTMLElement>(".resource-strip") ?? undefined));
  const [closing, setClosing] = createSignal<ReadonlySet<string>>(new Set());
  let before: Element | null = null;

  const extent = (): Extent => {
    const box = layer()?.getBoundingClientRect();

    return box && box.width > 0 && box.height > 0 ? { width: box.width, height: box.height } : FALLBACK_EXTENT;
  };

  // U524: the Terminal opened from the Project root stays shown while the selection stays there.
  const [fromRoot, setFromRoot] = createSignal<string | null>(null);

  const shown = createMemo(() => rail.selected() === null
    ? rail.terminals().filter((terminal) => terminal.owner === path || terminal.id === fromRoot())
    : shownFor(rail.terminals(), rail.nodes, rail.selected()));

  // U524: the pane placeholder gives way while a Terminal opened from the root is shown.
  createEffect(() => {
    const stack = layer()?.parentElement;

    if (!stack) return;

    stack.toggleAttribute("data-root-terminal", rail.selected() === null && shown().length > 0);
    onCleanup(() => stack.removeAttribute("data-root-terminal"));
  });

  const placeOf = (id: string): Place => places()[id] ?? defaultPlace(extent());

  // A bubble's default place is stored when it first shows, so hiding it, moving another or resizing the window never shifts it (U164).
  // U2224: selecting an Agent row folds every bubble to its chip, so none covers the output it selects.
  let lastSelected: string | null | undefined;

  createEffect(() => {
    // Save a fresh default only after the layer excludes the resource strip; an early rectangle would persist the wrong inset.
    if (!measured()) return;

    const eligible = shown();
    const chosen = rail.selected();
    const folds = lastSelected !== undefined && chosen !== lastSelected && rail.nodes.some((candidate) => candidate.id === chosen && candidate.kind === "agent");

    lastSelected = chosen;

    const held = untrack(places);
    const missing = eligible.filter((terminal) => held[terminal.id] === undefined);
    const visible = eligible.filter((terminal) => held[terminal.id] && !held[terminal.id]!.min);
    const next = { ...held };
    const latest = folds ? undefined : visible.at(-1)?.id ?? missing.at(-1)?.id;

    for (const terminal of missing) next[terminal.id] = { ...defaultPlace(untrack(extent)), min: terminal.id !== latest };

    for (const terminal of visible) next[terminal.id] = { ...next[terminal.id]!, min: terminal.id !== latest };

    if (folds) for (const terminal of eligible) next[terminal.id] = { ...next[terminal.id]!, min: true };

    if (JSON.stringify(next) === JSON.stringify(held)) return;
    setPlaces(next);
    persistPlaces(next);
  });

  const setPlace = (id: string, place: Place): void => {
    const next = { ...places(), [id]: place };

    setPlaces(next);
    persistPlaces(next);
  };

  const nameFor = (terminal: TerminalInfo): string => shownName(terminal, places()[terminal.id]);

  /** U511: a trimmed name that differs from the shown one is saved on the Terminal's place; an empty one clears it. */
  const rename = (terminal: TerminalInfo, value: string): string | null => {
    const name = value.trim();

    if (name === nameFor(terminal) || (name === "" && places()[terminal.id]?.name === undefined)) return null;

    const { name: _previous, ...place } = placeOf(terminal.id);

    const next = { ...places(), [terminal.id]: name === "" ? place : { ...place, name } };
    const failure = store.write(next);

    if (failure === null) setPlaces(next);

    return failure;
  };

  const show = (id: string | null): void => {
    if (id !== null && !shown().some((terminal) => terminal.id === id)) return;

    const next = { ...places() };

    for (const terminal of shown()) next[terminal.id] = { ...placeOf(terminal.id), min: terminal.id !== id };
    setPlaces(next);
    persistPlaces(next);
  };

  const openRecovery = () => {
    show(null);
    // Let the Terminal's dismissable layer close before the recovery layer takes focus.
    setTimeout(() => recover(true));
  };

  // Saved places end with the Daemon; its last readable screens keep their current geometry and visibility until the view ends.
  createEffect(() => {
    if (connected.daemonExit() !== null) {
      store.clear();

      return;
    }

    const listed = new Set(rail.terminals().map((terminal) => terminal.id));
    const held = untrack(places);
    const kept = Object.fromEntries(Object.entries(held).filter(([id]) => listed.has(id)));

    if (Object.keys(kept).length !== Object.keys(held).length) {
      setPlaces(kept);
      persistPlaces(kept);
    }
  });

  // The layer shrinks when the Shelf opens or the window narrows: every place is kept inside it (U164).
  createEffect(() => {
    const host = layer();

    if (!host || typeof ResizeObserver === "undefined") return;

    // U469: the layer ends above the bar.
    const sync = (): void => {
      const stack = host.parentElement?.getBoundingClientRect();
      const composer = host.parentElement?.querySelector(".resource-strip")?.getBoundingClientRect();
      host.style.bottom = stack && composer && composer.height > 0 ? `${Math.max(0, stack.bottom - composer.top)}px` : "";

      const corner = host.getBoundingClientRect();

      setOrigin((held) => (held.left === corner.left && held.top === corner.top && held.width === corner.width && held.height === corner.height ? held : { left: corner.left, top: corner.top, width: corner.width, height: corner.height }));
      setMeasured(true);
    };

    const watched = new ResizeObserver(() => {
      sync();

      const held = untrack(places);
      const next = Object.fromEntries(Object.entries(held).map(([id, place]) => [id, clamped(place, extent())]));

      if (JSON.stringify(next) === JSON.stringify(held)) return;

      setPlaces(next);
      persistPlaces(next);
    });

    watched.observe(host);
    window.addEventListener("resize", sync);
    onCleanup(() => window.removeEventListener("resize", sync));

    if (host.parentElement) watched.observe(host.parentElement);

    // The composer comes and goes with the selection, which moves no size the observer sees.
    const arrivals = new MutationObserver((records) => {
      if (records.some((record) => !host.contains(record.target))) sync();
    });

    if (host.parentElement) arrivals.observe(host.parentElement, { childList: true, subtree: true });
    sync();
    onCleanup(() => {
      watched.disconnect();
      arrivals.disconnect();
    });
  });

  const readOnly = () => connected.daemonExit() !== null;

  const close = async (id: string): Promise<void> => {
    if (closing().has(id)) return;

    const active = document.activeElement;
    const controlHeldFocus = active instanceof Element && active.closest("[data-bubble]")?.getAttribute("data-bubble") === id;
    setClosing((ids) => new Set([...ids, id]));

    try {
      await app.rpc("terminal.close", { id });
      await rail.refresh({ terminals: true });
      setFailure(null);

      if (controlHeldFocus) queueMicrotask(() => {
        const remaining = shown();
        const nextId = remaining.find((terminal) => Number(terminal.id) > Number(id))?.id ?? remaining.at(-1)?.id;
        const control = nextId === undefined ? document.querySelector<HTMLElement>('.terminal-new') : document.querySelector<HTMLElement>(`.terminal-tab[data-bubble="${nextId}"]`);
        control?.focus();
      });
    } catch (thrown) {
      if (!(thrown instanceof Error)) throw thrown;

      setFailure(thrown.message);
    } finally {
      setClosing((ids) => new Set([...ids].filter((held) => held !== id)));
    }
  };

  const bubbleElement = (id: string): HTMLElement | null => document.querySelector<HTMLElement>(`[data-bubble="${id}"]`);

  const focusItem = (id: string): void => {
    const place = places()[id];

    if (place?.min) document.querySelector<HTMLElement>(`.terminal-tab[data-bubble="${id}"]`)?.focus();
    else props.screens.emulatorFor(id).focus();
  };

  const focusedId = (active: Element | null = document.activeElement): string | null => {
    return active instanceof Element ? (active.closest<HTMLElement>("[data-bubble]")?.dataset.bubble ?? null) : null;
  };

  const toggleMinimised = (id: string, wasMin = placeOf(id).min): void => {
    const place = { ...placeOf(id), min: wasMin };

    if (place.min) show(id);
    else setPlace(id, { ...place, min: true });
    queueMicrotask(() => focusItem(id));
  };

  const closeFocused = (focus: Element | null): void => {
    const id = focusedId(focus);

    if (id === null) return;

    const back = before;
    const fromTab = focus?.closest(".terminal-tabs") !== null;

    void close(id).then(() => {
      if (failure() !== null || fromTab) return;

      if (back instanceof HTMLElement && back.isConnected) back.focus();
      else focusPane();
    });
  };

  const terminalOwner = () => resolvedWorkstream(rail.nodes, rail.selected()) ?? siblingsOf(rail.nodes, null).find(isWorkstream)?.id ?? null;

  /** The id `terminal.open` answered, else null when there was nothing to open or the call failed. */
  const openTerminal = async (): Promise<string | null> => {
    // U524: a selection that resolves to no Workstream (the Project root) opens in the first Workstream in Rail order.
    const workstream = terminalOwner();

    if (opening() || readOnly()) return null;

    setOpening(true);

    try {
      const opened = await app.rpc("terminal.open", { workstream });

      setFromRoot(rail.selected() === null ? opened.terminal_id : null);
      setWanted(opened.terminal_id);
      setFailure(null);
      await rail.refresh({ terminals: true });
      show(opened.terminal_id);

      return opened.terminal_id;
    } catch (thrown) {
      if (!(thrown instanceof Error)) throw thrown;

      setFailure(thrown.message);

      return null;
    } finally {
      setOpening(false);

      if (failure() !== null && shown().length === 0) document.querySelector<HTMLElement>(".terminal-new")?.focus({ preventScroll: true });
    }
  };

  const open = async (): Promise<void> => {
    await openTerminal();
  };

  // Pull and ⌘B share the last eligible focus, falling back to the latest started Terminal.
  let lastFocused: string | null = null;

  const lastTarget = (): string | null => {
    const ids = shown().filter((terminal) => !closing().has(terminal.id)).map((terminal) => terminal.id);

    return lastFocused !== null && ids.includes(lastFocused) ? lastFocused : (ids.at(-1) ?? null);
  };

  /** Holds the middle of `id`'s header under the pointer, kept inside the pane by `clamped`. */
  const holdAt = (id: string, pointer: { x: number; y: number }): void => {
    const box = layer()?.getBoundingClientRect();
    const header = bubbleElement(id)?.querySelector<HTMLElement>(".bubble-header")?.offsetHeight ?? 0;
    const place = placeOf(id);

    show(id);
    setPlace(id, clamped({ ...place, min: false, x: pointer.x - (box?.left ?? 0) - place.w / 2, y: pointer.y - (box?.top ?? 0) - header / 2 }, extent()));
  };

  /** U421: a right-button drag of `PULL_DISTANCE` pulls the selected Workstream's Terminal out under the pointer. */
  const pulling = () => {
    let press: { x: number; y: number } | null = null;
    let active = false;
    let pointer = { x: 0, y: 0 };
    let id: string | null = null;
    let frame: number | null = null;
    let swallowMenu = false;
    let swallowUp = false;

    const apply = (): void => {
      frame = null;

      if (id !== null) holdAt(id, pointer);
    };

    const schedule = (): void => {
      frame ??= requestAnimationFrame(apply);
    };

    const end = (): void => {
      if (frame !== null) {
        cancelAnimationFrame(frame);
        apply();
      }

      press = null;
      active = false;
    };

    const blocked = (): boolean =>
      resolvedWorkstream(rail.nodes, rail.selected()) === null || opening() || readOnly() || document.querySelector('[role="menu"], .switcher') !== null;

    const start = (): void => {
      active = true;

      const target = lastTarget();

      if (target !== null) {
        id = target;
        holdAt(target, pointer);

        return;
      }

      id = null;
      void openTerminal().then((opened) => {
        if (opened === null) return;

        // The pointer may have moved or let go while the call was in flight: the bubble goes to where it is now.
        requestAnimationFrame(() => holdAt(opened, pointer));
      });
    };

    const down = (event: PointerEvent): void => {
      swallowMenu = false;
      swallowUp = false;
      press = null;

      if (event.pointerType !== "mouse" || event.button !== 2 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || textTarget(event.target) || blocked()) return;

      press = { x: event.clientX, y: event.clientY };
      pointer = press;
    };

    const move = (event: PointerEvent): void => {
      if (press === null) return;

      pointer = { x: event.clientX, y: event.clientY };

      if (!active) {
        if ((event.buttons & 2) === 0 || Math.hypot(pointer.x - press.x, pointer.y - press.y) < PULL_DISTANCE) return;

        start();
      }

      // A Pull crossing a Terminal keeps its move and release out of that program.
      event.stopPropagation();

      if (id !== null) schedule();
    };

    const up = (event: PointerEvent): void => {
      if (press === null) return;

      if (active) {
        event.stopPropagation();
        swallowMenu = true;
        swallowUp = true;
      }

      end();
    };

    const swallow = (event: Event): void => {
      if (active) event.stopPropagation();
    };

    const swallowRelease = (event: Event): void => {
      if (!active && !swallowUp) return;

      swallowUp = false;
      event.stopPropagation();
    };

    const menu = (event: Event): void => {
      if (!active && !swallowMenu) return;

      swallowMenu = false;
      event.preventDefault();
      event.stopPropagation();
    };

    const listen = <K extends keyof WindowEventMap>(name: K, listener: (event: WindowEventMap[K]) => void): void => {
      window.addEventListener(name, listener, true);
      onCleanup(() => window.removeEventListener(name, listener, true));
    };

    listen("pointerdown", down);
    listen("pointermove", move);
    listen("pointerup", up);
    listen("pointercancel", end);
    listen("mousemove", swallow);
    listen("mouseup", swallowRelease);
    listen("contextmenu", menu);
    registerKeys({ kind: "app" }, [{
      chords: ESCAPE,
      when: () => active,
      run: () => {
        swallowMenu = true;
        end();
      },
    }]);
  };

  pulling();

  // The bubble the user opened takes the keys, whether its Terminal is listed before or after `terminal.open` answers.
  createEffect(() => {
    const id = wanted();

    if (id === null || !shown().some((terminal) => terminal.id === id)) return;

    queueMicrotask(() => {
      if (bubbleElement(id) === null) return;

      show(id);
      focusItem(id);
      setWanted(null);
    });
  });

  // U511: the name's editor owns its keys. Help and the Switcher are modal layers, so no chord acts under them (U54); a held key repeats nothing.
  const outsideEditor = (focus: EventTarget | null): boolean => !(focus instanceof Element && focus.closest(".terminal-tab-editor"));

  registerKeys({ kind: "app" }, [
    { action: CHORDS.find((row) => row.keys === "⌘T")!,
      when: (press) => outsideEditor(press.target),
      capture: (focus) => {
        const owner = terminalOwner();

        return {
          available: () => outsideEditor(focus) && !opening() && !readOnly() && terminalOwner() === owner,
          invoke: () => void open(),
        };
      },
    },
  ]);

  const mainTerminal = (): string | null => {
    const id = rail.nodes.find((node) => node.id === rail.selected())?.terminal_id ?? null;

    return id !== null && document.querySelector(".pane-screen textarea, .pane-screen [tabindex]") ? id : null;
  };

  const hasTerminalFocus = (focus: Element | null): boolean => focus?.isConnected === true && focus.closest(".bubble, button.terminal-tab, .pane-screen") !== null;

  const switchPair = (focus: Element | null) => {
    const selected = rail.selected();
    const main = mainTerminal();
    const fromBubble = focusedId(focus);
    const target = fromBubble ?? lastTarget();
    const inTerminal = hasTerminalFocus(focus);
    const toAgent = fromBubble !== null && focus?.closest(".bubble") !== null;

    return {
      available: () => focus?.isConnected === true && inTerminal && !readOnly() && main !== null && mainTerminal() === main
        && rail.selected() === selected && target !== null && shown().some((terminal) => terminal.id === target) && !closing().has(target),
      invoke: () => {
        if (toAgent) {
          show(null);
          props.screens.emulatorFor(main!).focus();
        } else {
          show(target);
          // The manual popover becomes focusable when Solid commits this turn's visibility change.
          queueMicrotask(() => {
            if (focus?.isConnected && !readOnly() && rail.selected() === selected && mainTerminal() === main && shown().some((terminal) => terminal.id === target) && !closing().has(target!) && !placeOf(target!).min) props.screens.emulatorFor(target!).focus();
          });
        }
      },
    };
  };

  registerKeys({ kind: "app" }, [{
    action: CHORDS.find((row) => row.keys === "⌘B")!,
    when: () => hasTerminalFocus(document.activeElement),
    capture: switchPair,
  }]);

  const hasFocusedBubble = (focus: Element | null): boolean => {
    const id = focusedId(focus);

    return focus?.isConnected === true && id !== null && shown().some((terminal) => terminal.id === id) && !readOnly() && !closing().has(id);
  };

  registerKeys({ kind: "leader" }, [
    { action: LEADER.find((row) => row.keys === "M")!, capture: (focus) => {
      const id = focusedId(focus);
      const wasMin = id !== null && placeOf(id).min;

      return { available: () => hasFocusedBubble(focus), invoke: () => toggleMinimised(id!, wasMin) };
    } },
    { action: LEADER.find((row) => row.keys === "W")!, capture: (focus) => ({ available: () => hasFocusedBubble(focus), invoke: () => closeFocused(focus) }) },
  ]);

  const onFocusIn = (event: FocusEvent): void => {
    if (!(event.target instanceof Element) || event.target.closest("[data-bubble]")) return;

    before = event.target;
  };

  const onBubbleFocus = (event: FocusEvent): void => {
    if (!(event.target instanceof Element)) return;

    const id = event.target.closest<HTMLElement>("[data-bubble]")?.dataset.bubble;

    if (id !== undefined) lastFocused = id;
  };

  // Focus landing on a control outside the bubbles (⌘K's Switcher, ⌘/'s Ask bar) minimises every open bubble, so the focused control is never under the top layer, whether or not focus began inside a bubble.
  const onFocusLeave = (event: FocusEvent): void => {
    const { target } = event;

    if (!(target instanceof Element) || target.closest("[data-bubble], .bubble-frame, .terminal-tab-pair, .terminal-recover, [role=menu], [role=menuitem]")) return;

    for (const { id } of shown()) if (!placeOf(id).min) setPlace(id, { ...placeOf(id), min: true });
  };

  // U529: the Switcher chose a Terminal; its owner is selected by now, so the bubble is listed.
  const onReveal = (event: Event): void => {
    const id = event instanceof CustomEvent ? String(event.detail) : null;

    if (id === null || !shown().some((terminal) => terminal.id === id)) return;

    show(id);
    queueMicrotask(() => focusItem(id));
  };

  window.addEventListener(REVEAL_BUBBLE, onReveal);
  onCleanup(() => window.removeEventListener(REVEAL_BUBBLE, onReveal));
  document.addEventListener("focusin", onFocusIn);
  document.addEventListener("focusin", onBubbleFocus);
  document.addEventListener("focusin", onFocusLeave);
  onCleanup(() => {
    document.removeEventListener("focusin", onFocusLeave);
    document.removeEventListener("focusin", onBubbleFocus);
    document.removeEventListener("focusin", onFocusIn);
  });

  // Bubbles are keyed by id: a refreshed `terminal.list` brings new objects for the same Terminals, and a remount would drop the emulator's focus.
  const shownIds = createMemo(() => shown().map((terminal) => terminal.id), [], { equals: (a, b) => a.length === b.length && a.every((id, at) => id === b[at]) });

  const Bubble = (bubble: { id: string }) => {
    const id = bubble.id;
    const terminal = createMemo(() => shown().find((candidate) => candidate.id === id) ?? rail.terminals().find((candidate) => candidate.id === id));
    let body: HTMLDivElement | undefined;
    let frame: number | null = null;

    const place = () => placeOf(id);

    const refit = () => {
      frame = null;

      if (body && !place().min && !readOnly()) props.screens.resize(id, props.screens.emulatorFor(id).fit(), true);
    };

    const refitNextFrame = () => {
      frame ??= requestAnimationFrame(refit);
    };

    onCleanup(() => {
      if (frame !== null) cancelAnimationFrame(frame);

      props.screens.viewing(id, false);
      props.screens.hide(id);
    });

    // A Terminal is viewed while its Bubble is open; a folded or closed one gathers unseen output.
    createEffect(() => props.screens.viewing(id, !place().min));

    const mount = (host: HTMLDivElement) => {
      body = host;

      props.screens.resize(id, props.screens.show(id, host, false));

      if (typeof ResizeObserver !== "undefined") {
        const watched = new ResizeObserver(refitNextFrame);

        watched.observe(host);
        onCleanup(() => watched.disconnect());
      }
    };

    // A bubble that was folded is fitted again when it comes back.
    createEffect(on(() => place().min, (folded) => { if (!folded) refitNextFrame(); }, { defer: true }));

    const drag = (start: PointerEvent, change: (from: Place, dx: number, dy: number) => Place) => {
      if (start.button !== 0) return;

      start.preventDefault();

      const from = place();
      const move = (event: PointerEvent) => setPlace(id, clamped(change(from, event.clientX - start.clientX, event.clientY - start.clientY), extent()));

      const stop = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", stop);
      };

      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", stop);
    };

    // The restore of the zone resize in flight, if any; Escape runs it through the registry.
    let restoreResize: (() => void) | undefined;

    registerKeys({ kind: "app" }, [{ chords: ESCAPE, when: () => restoreResize !== undefined, run: () => restoreResize?.() }]);

    /** U2236: a press on a zone resizes about the centre, one style write per frame; Escape puts the place back. */
    const resize = (start: PointerEvent, zone: Zone) => {
      if (start.button !== 0) return;

      start.preventDefault();
      start.stopPropagation();

      const from = place();
      let pointer = { x: start.clientX, y: start.clientY };
      let pending: number | null = null;

      const apply = () => {
        pending = null;
        setPlace(id, resizedAbout(from, zone, pointer.x - start.clientX, pointer.y - start.clientY, extent()));
      };

      const move = (event: PointerEvent) => {
        pointer = { x: event.clientX, y: event.clientY };
        pending ??= requestAnimationFrame(apply);
      };

      const finish = (restore: boolean) => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", cancel);
        restoreResize = undefined;

        if (pending !== null) cancelAnimationFrame(pending);

        if (restore) setPlace(id, from);
        else if (pending !== null) apply();

        pending = null;
      };

      const up = () => finish(false);
      const cancel = () => finish(true);

      try {
        if (start.target instanceof Element) start.target.setPointerCapture?.(start.pointerId);
      } catch {
        // The window listeners still follow the pointer.
      }

      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", cancel);
      restoreResize = cancel;
    };

    let header: HTMLElement | undefined;

    // Arrows on the focused header move the bubble, Shift arrows resize it; the registry matches the exact modifiers.
    registerKeys({ kind: "region", element: () => header }, [{
      chords: [...ARROWS.keys(), ...[...ARROWS.keys()].map((key) => `${SHIFT}${key}`)],
      when: (press) => press.target === header,
      run: (press) => {
        const arrow = ARROWS.get(press.key)!;
        const from = place();

        setPlace(id, clamped(press.shiftKey ? { ...from, w: from.w + arrow[0] * STEP, h: from.h + arrow[1] * STEP } : { ...from, x: from.x + arrow[0] * STEP, y: from.y + arrow[1] * STEP }, extent()));
      },
    }]);

    let panel: HTMLElement | undefined;

    // The browser top layer orders by the last `showPopover`, so a restored bubble is the topmost layer and no z-index ranks it (U2307b).
    createEffect(() => {
      const open = !place().min;

      if (!panel?.showPopover) return;

      if (open && !panel.matches(":popover-open")) panel.showPopover();
      else if (!open && panel.matches(":popover-open")) panel.hidePopover();
    });

    /** U2307a: a primary press outside the bubble minimises it; its own tab or chip toggles it, and the press still reaches its target. */
    const dismissed = (event: { detail: { originalEvent: Event } }): void => {
      const press = event.detail.originalEvent;
      const target = press.target;

      if (!(press instanceof PointerEvent) || press.button !== 0 || (target instanceof Element && target.closest(".terminal-tab-pair, .terminal-recover"))) return;

      if (!place().min) setPlace(id, { ...place(), min: true });
    };

    return (
      <Panel.Root open={!place().min} onPointerDownOutside={dismissed}>
        <Portal>
          <Panel.Content ref={(element: HTMLElement) => (panel = element)} class="bubble-frame" role="presentation" popover="manual"
            style={{ left: `${origin().left}px`, top: `${origin().top}px` }}>
            <section class="bubble" data-bubble={id} role="group" aria-label={nameFor(terminal()!)} hidden={place().min}
              style={{ left: `${place().x}px`, top: `${place().y}px`, width: `${place().w}px`, height: `${place().h}px` }}>
              <header class="bubble-header" tabindex="0" ref={header} onPointerDown={(event) => {
                  // SAFETY: a pointer event on the header always targets an Element.
                  if (!(event.target as Element).closest("button")) drag(event, (from, dx, dy) => ({ ...from, x: from.x + dx, y: from.y + dy }));
                }} onDblClick={(event) => {
                  // SAFETY: a mouse event on the header always targets an Element.
                  if (!(event.target as Element).closest("button")) setPlace(id, toggledFill(place(), extent()));
                }}>
                <span class="bubble-controls">
                  <IconButton data-feedback="ink" aria-label={copy.close} onClick={() => void close(id)}><span class="bubble-dot"><Icon name="x" /></span></IconButton>
                  <IconButton data-feedback="ink" aria-label={copy.minimise} onClick={() => toggleMinimised(id)}><span class="bubble-dot"><Icon name="minus" /></span></IconButton>
                </span>
                <span class="bubble-name">{nameFor(terminal()!)}</span>
              </header>
              <div class="bubble-body" ref={mount} /><ReservedLine overlay class={props.screens.failure(id) ? "bubble-failure" : undefined} message={props.screens.failure(id)} />
            </section>
            <For each={ZONES}>{(zone) => (
              <span class="bubble-zone" data-zone={zone.name} data-zone-of={id} aria-hidden="true" hidden={place().min}
                style={{ cursor: zone.cursor, ...zoneBox(place(), zone) }} onPointerDown={(event) => resize(event, zone)} />
            )}</For>
          </Panel.Content>
        </Portal>
      </Panel.Root>
    );
  };

  const Tab = (tabProps: { id: string }) => {
    const id = tabProps.id;
    const terminal = () => shown().find((candidate) => candidate.id === id)!;

    const name = () => nameFor(terminal());
    const [nameRef, nameCut] = createCut();
    let destination = Object.freeze({ surface: "bubbles", object: terminal().incarnation, recipient: id });
    createEffect(() => { if (editing()?.id === id) onCleanup(drafts.editor(destination)); });
    const current = () => records().filter(draft => draft.destination.object === terminal().incarnation && draft.destination.recipient === id && draft.status === "draft" && !draft.value.recovery).at(-1);
    let base = "";
    let initial = "";
    let revision: string | undefined;
    let selection: ReturnType<typeof drafts.list>[number]["selection"] = null;
    let restored: "none" | "current" | "selected" | "branch" = "none";
    const [changed, change] = createSignal(false);
    const requiresConfirmation = () => restored === "selected" || restored === "branch";

    const start = (selected?: { project: string; revision: string }) => {
      const target = Object.freeze({ surface: "bubbles", object: terminal().incarnation, recipient: id });

      const retained = selected ? records().find(draft => draft.revision === selected.revision)
        : current() ?? records().filter(draft => draft.destination.object === target.object && draft.destination.recipient === id && draft.status === "failed").at(-1);

      const parsed = retained && v.safeParse(schema, retained.value);

      if (selected && (selected.project !== path || !retained || retained.status === "pending" || !parsed?.success
        || retained.destination.object !== target.object || retained.destination.recipient !== id
        || !terminal().running || readOnly())) return;

      if (!terminal().running || readOnly() || (retained && !parsed?.success)) {
        openRecovery();

        return;
      }

      destination = target;
      restored = retained?.value.recovery === true || (selected && retained?.revision !== current()?.revision) ? "branch"
        : selected ? "selected" : retained ? "current" : "none";
      initial = parsed?.success ? parsed.output.name : name();
      base = parsed?.success ? parsed.output.base : name();
      revision = retained?.revision;
      selection = retained?.selection ?? null;
      change(false);
      setEditing({ id });
    };

    const capture = (input: HTMLInputElement) => {
      const caret = { start: input.selectionStart ?? 0, end: input.selectionEnd ?? 0, direction: input.selectionDirection ?? "none" };
      const previous = records().find(draft => draft.revision === revision);

      if (previous?.value.name === input.value) {
        if (JSON.stringify(previous.selection) !== JSON.stringify(caret)) drafts.setSelection(previous.revision, caret);

        return;
      }

      // A selected edit is a separate recovery branch; the ordinary current draft stays current.
      const draftValue = restored === "branch" ? { name: input.value, base, recovery: true } : { name: input.value, base };
      revision = drafts.edit(destination, draftValue, caret, "ordinary", revision ?? null).draft.revision;
    };

    createEffect(on(() => props.recovery, selected => { if (selected) start(selected); }));

    createEffect(() => {
      if (terminal().incarnation !== destination.object || !terminal().running || readOnly()) setEditing(held => held?.id === id ? null : held);
    });

    const tab = () => document.querySelector<HTMLElement>(`button.terminal-tab[data-bubble="${id}"]`);

    /** U2694b: Rename, Send to Agent ▸, Copy Link and Close, as the system menu of the tab. */
    const tabMenu = (x: number, y: number) => {
      const agents = rail.nodes;

      return contextMenu(app, [
        { id: "rename", label: copy.rename, run: start },
        ...linkEntries(app, { kind: "terminal", id: id }, agents, (node) => rail.exitOf(node) === null, setFailure),
        { id: "close", label: copy.close, shortcut: lastTarget() === id ? copy.closeChord : undefined, run: () => close(id) },
      ], x, y);
    };

    return <>
      <FlatTab class="terminal-tab-pair" onContextMenu={(event: MouseEvent) => openOnRelease(event, (x, y) => void tabMenu(x, y))} selected={!placeOf(id).min} data-bubble={id}>
        <Show when={editing()?.id === id ? editing() : null} keyed fallback={
          <Tip content={name()} cut={nameCut}>
            {(trigger) => (
              <button {...trigger()} type="button" data-button="quiet" data-reads={!placeOf(id).min ? "text" : undefined} class="terminal-tab" data-bubble={id}
                aria-label={name()} aria-describedby={props.screens.unseen(id) ? `terminal-state-${id}` : undefined} aria-pressed={!placeOf(id).min}
                onClick={() => toggleMinimised(id)}
                onDblClick={(event) => { if (event.target instanceof Element && event.target.closest(".terminal-tab-name")) start(); }}>
                <span class="terminal-tab-name" ref={nameRef}>{name()}</span>
                <span class="terminal-tab-slot"><Show when={props.screens.unseen(id)}><span id={`terminal-state-${id}`} class="terminal-tab-unseen" data-state="" role="img" aria-label={copy.unseenOutput}>{copy.unseenMark}</span></Show></span>
              </button>
            )}
          </Tip>
        }>{_edit =>
          <div class="terminal-tab terminal-tab-editor" data-bubble={id} data-pressed={!placeOf(id).min}>
            <Editable.Root selectOnFocus={false} defaultValue={initial} activationMode="none" submitMode={requiresConfirmation() || (restored === "current" && !changed()) ? "enter" : "both"} finalFocusEl={tab}
              onValueCommit={({ value }) => {
                const submitted = revision;
                const live = rail.terminals().find(candidate => candidate.incarnation === destination.object && candidate.id === id && candidate.running);

                if (!live || readOnly() || base !== nameFor(live)) {
                  openRecovery();

                  return;
                }

                if (submitted && !drafts.submit(submitted)) {
                  openRecovery();

                  return;
                }

                const failure = rename(live, value);

                if (submitted) drafts.settle(submitted, failure === null ? "acknowledged" : "failed");
                setFailure(failure);

                if (failure !== null) openRecovery();
              }}
              onEditChange={({ edit }) => { if (!edit) setEditing(null); }}>
              <Editable.Context>{(api) => {
                onMount(() => api().edit());

                return null;
              }}</Editable.Context>
              <Editable.Area><Editable.Preview /><Editable.Input aria-label={copy.terminalName}
                onBlur={() => { if (requiresConfirmation()) setEditing(null); }}
                onInput={event => { change(true); capture(event.currentTarget); }}
                onSelect={event => { if (document.activeElement === event.currentTarget && revision) capture(event.currentTarget); }} ref={(input: HTMLInputElement) => {
                // Chromium's select() leaves focus where it was; the editor takes it, with the whole name selected, after the library's own step.
                onMount(() => requestAnimationFrame(() => { if (!input.isConnected) return;
                  input.focus({ preventScroll: true });

                  if (selection) input.setSelectionRange(selection.start, selection.end, selection.direction);
                  else input.select(); }));
              }} /></Editable.Area>
            </Editable.Root>
            <span class="terminal-tab-slot"><Show when={props.screens.unseen(id)}><span id={`terminal-state-${id}`} class="terminal-tab-unseen" data-state="" role="img" aria-label={copy.unseenOutput}>{copy.unseenMark}</span></Show></span>
          </div>}
        </Show>
        <IconButton aria-label={copy.closeTerminal(name())} onClick={() => void close(id)}><Icon name="x" /></IconButton>
      </FlatTab>
    </>;
  };

  const recoveryNotice = createMemo(() => shownDraft() ? !original(shownDraft()!) || readOnly() ? copy.originalUnavailable : shownDraft()!.value.base !== nameFor(original(shownDraft()!)!) ? copy.railDraftConflict : null : null);

  return (
    <div class="bubbles" ref={setLayer}>
      <For each={shownIds()}>{(id) => <Bubble id={id} />}</For>
      <Show when={bar()}>{(host) => <Portal mount={host()} ref={(element) => { element.classList.add("terminal-tabs-host"); }}>
        <div class="terminal-tabs" role="group" aria-label={copy.terminals} onFocusIn={(event) => {
          if (event.target instanceof HTMLElement) event.target.scrollIntoView({ block: "nearest", inline: "nearest" });
        }}>
          <For each={shownIds()}>{id => <Tab id={id} />}</For>
          <Show when={records().length || problem()}><IconButton class="terminal-recover" aria-label={copy.draftIdentity(copy.recoverDrafts, copy.terminalName)} onClick={() => openRecovery()}><Icon name="edit" /></IconButton></Show>
          <FlatAdd data-button="add" class="terminal-new" aria-label={copy.newTerminal} onClick={() => void open()}>{copy.plusTerminal}</FlatAdd>
        </div>
      </Portal>}</Show>
      <Dialog.Root instant open={recovering()} onOpenChange={details => recover(details.open)}>
        <Portal><Dialog.Positioner asChild={positioner => <aside {...positioner({})} />}><Dialog.Content class="draft-recovery bubble-recovery" ref={element => { recoveryPanel = element; }}>
          <Dialog.Title asChild={title => <h2 {...title({})}>{copy.unfinishedWork}</h2>} />
          <Dialog.Description class="draft-identity">{copy.draftIdentity(connected.project.name, copy.terminalName)}</Dialog.Description>
          <ReservedLine message={(copyFailure()) || (problem() ? (copy.draftRetention(connected.project.name, copy.terminalName, problem()!.cause)) : null) || null} />
          <Show when={records().length > 1}><For each={[...records()].reverse().sort((a, b) => Number(b.status === "draft") - Number(a.status === "draft"))}>{(draft, index) => <button type="button" data-button="quiet" aria-pressed={shownDraft()?.revision === draft.revision} onClick={() => inspect(draft.revision)}>{copy.draftIdentity(copy.inspectDraft, draft.status === "draft" ? copy.currentDraft : copy.draftStatus[draft.status], String(draft.value.base ?? ""), String(index() + 1))}</button>}</For></Show>
          <Show when={shownDraft()}>{draft => <>
            <p class="draft-identity">{copy.draftIdentity(String(draft().value.base ?? ""), draft().destination.recipient ?? copy.noDraftRecipient)}</p>
            <ReservedLine status={recoveryNotice() ?? copy.draftStatus[draft().status]} data-state={draft().status} />
            <pre class="draft-value">{String(draft().value.name ?? "")}</pre>
          </>}</Show>
          <div class="draft-actions">
            <Show when={shownDraft()}>{draft => <><button type="button" data-button="quiet" onClick={() => void copyName()}>{copy.copyProjectName}</button>
            <button type="button" data-button="quiet" onClick={() => { drafts.discard(draft().revision); setEditing(null); }}>{copy.discardRevision}</button></>}</Show>
            <Show when={problem()}><button type="button" data-button="quiet" onClick={() => drafts.retry()}>{copy.storageRetry}</button></Show>
            <Dialog.CloseTrigger data-button="quiet">{copy.close}</Dialog.CloseTrigger>
          </div>
        </Dialog.Content></Dialog.Positioner></Portal>
      </Dialog.Root>
      <ReservedLine overlay class={failure() ? "bubble-failure" : undefined} message={failure()} />
    </div>
  );
};
