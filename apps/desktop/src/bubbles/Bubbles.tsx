import { ProgramStatusMark, tabLabel } from "../terminal/programStatus";
import { closeFocused as closeBubble, bubbleElement, focusedId, focusItem as focusBubble, onBubbleFocus as trackBubbleFocus, hasTerminalFocus } from "./focus";
import { outcomeOf } from "../app/seam";
import { captureFocus } from "../keys/focus";
import { createCopyFeedback, CopyButton } from "../ui/CopyButton";
import { createTerminalClose } from "./close";
import { ReservedLine } from "../ink/ReservedLine";
import { CHORDS, LEADER } from "../keys/chords";
import { registerKeys } from "../keys/registry";
import * as v from "valibot";
import { Dialog } from "../ui/Dialog";
import { Editable } from "../ui/Editable";
import { FlatAdd, FlatTab } from "../ui/FlatTab";
import { IconButton } from "../ui/IconButton";
import { contextMenu, linkEntries, openOnRelease, textTarget, PULL_DISTANCE } from "../ui/contextMenu";
import { Bubble } from "./Bubble";
import { copy } from "./copy";
import { createEffect, createMemo, createSignal, For, on, onCleanup, onMount, Show, untrack } from "solid-js";
import { Portal } from "solid-js/web";
import { HintLine } from "../keys/HintLine";
import type { TerminalInfo } from "@contracts/terminal/TerminalInfo";
import { Icon } from "../ink/Icon";
import { createCut } from "../ink/Tip";
import { Tip } from "../ui/Tip";
import { surfaceOpen } from "../ui/openSurfaces";
import { isWorkstream, resolvedWorkstream, siblingsOf } from "../rail/layout";
import { useConnectedProject, useCreation } from "../state/connectedProject";
import type { Screens } from "../terminal/screens";
import {
  clamped, defaultPlace, extentOf, placesStorage, REVEAL_BUBBLE, shownFor, shownName,
} from "./places";
import type { Place, Extent } from "./places";
import "./styles.css";

const ESCAPE = "Escape".split(" ");

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
  const [copyFailure, failCopy] = createSignal<{ revision: string; message: string } | null>(null);
  createEffect(() => {
    const listed = records();
    const prior = untrack(copyFailure);

    if (prior && !listed.some(draft => draft.revision === prior.revision)) failCopy(null);
  });
  const shownDraft = () => records().find(draft => draft.revision === inspected()) ?? records().filter(draft => draft.status === "draft" && !draft.value.recovery).at(-1) ?? records().at(-1);

  const problem = () => {
    const failure = drafts.problem();

    return failure?.destination && failure.destination.surface !== "bubbles" ? null : failure;
  };

  const original = (draft: ReturnType<typeof drafts.list>[number]) => rail.terminals().find(terminal => terminal.incarnation === draft.destination.object && terminal.id === draft.destination.recipient && terminal.running);
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
  const [failure, setFailure] = createSignal<{ message: string; terminal: { id: string; incarnation: string } | null } | null>(null);

  const clearItemFailure = (terminal: { id: string; incarnation: string }) => {
    rail.commandFailure.acknowledgeTerminal(terminal);
    setFailure(prior => prior?.terminal?.id === terminal.id && prior.terminal.incarnation === terminal.incarnation ? null : prior);
  };

  createEffect(() => {
    const terminals = rail.terminals();

    if (connected.daemonExit() !== null) return;
    const prior = untrack(failure);

    if (prior?.terminal && !terminals.some(terminal => terminal.id === prior.terminal!.id && terminal.incarnation === prior.terminal!.incarnation)) setFailure(null);
  });
  const [opening, setOpening] = createSignal(false);
  const [reserved, setReserved] = createSignal<Record<string, string | null>>({});
  const bubbleMenus = new Map<string, (event: MouseEvent) => void>();
  let openingController: AbortController | undefined;
  onCleanup(() => openingController?.abort());
  createEffect(on(rail.selected, () => openingController?.abort(), { defer: true }));
  const destinations = new Map<string, (destination: { host: HTMLElement; settled: () => boolean }) => void>();
  const [openingSelection, setOpeningSelection] = createSignal<string | null>();
  const [wanted, setWanted] = createSignal<{ id: string; focus: ReturnType<typeof captureFocus> } | null>(null);
  const [layer, setLayer] = createSignal<HTMLElement>();
  const [bar, setBar] = createSignal<HTMLElement>();
  const parkedTabs = document.createElement("div");
  const [measured, setMeasured] = createSignal(false);
  const [origin, setOrigin] = createSignal({ left: 0, top: 0, width: 0, height: 0 });
  const [editing, setEditing] = createSignal<{ id: string } | null>(null);
  createEffect(on(() => rail.selected(), () => setEditing(null), { defer: true }));
  onMount(() => setBar(layer()?.parentElement?.querySelector<HTMLElement>(".resource-agent") ?? undefined));
  let before: Element | null = null;

  const extent = (): Extent => extentOf(layer());

  // U524: every Terminal opened from the Project root stays available alongside Project-owned Terminals.
  const [fromRoot, setFromRoot] = createSignal<readonly { id: string; listed: boolean }[]>([]);
  const [openedHere, setOpenedHere] = createSignal<readonly string[]>([]);
  createEffect(on(() => rail.selected(), () => setOpenedHere([]), { defer: true }));

  const shown = createMemo(() => {
    if (rail.selected() === null) return rail.terminals().filter((terminal) => terminal.owner === path || fromRoot().some(root => root.id === terminal.id));
    const eligible = shownFor(rail.terminals(), rail.nodes, rail.selected());

    return [...eligible, ...rail.terminals().filter(terminal => openedHere().includes(terminal.id) && !eligible.some(shown => shown.id === terminal.id))];
  });

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

    const prior = untrack(places);
    const missing = eligible.filter((terminal) => prior[terminal.id] === undefined);
    const visible = eligible.filter((terminal) => prior[terminal.id] && !prior[terminal.id]!.min);
    const next = { ...prior };
    const latest = folds ? undefined : visible.at(-1)?.id ?? missing.at(-1)?.id;

    for (const terminal of missing) next[terminal.id] = { ...defaultPlace(untrack(extent)), min: (opening() && chosen === openingSelection()) || terminal.id !== latest };

    for (const terminal of visible) next[terminal.id] = { ...next[terminal.id]!, min: terminal.id !== latest };

    if (folds) for (const terminal of eligible) next[terminal.id] = { ...next[terminal.id]!, min: true };

    if (JSON.stringify(next) === JSON.stringify(prior)) return;
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

  const openRecovery = (target?: () => HTMLElement | null | undefined) => {
    show(null);
    // Let the Terminal's dismissable layer close before the recovery layer takes focus.
    const focus = captureFocus(true);
    setTimeout(() => focus(() => { target?.()?.focus(); recover(true); }));
  };

  // Saved places end with the Daemon; its last readable screens keep their current geometry and visibility until the view ends.
  createEffect(() => {
    if (connected.daemonExit() !== null) {
      store.clear();

      return;
    }

    const listed = new Set(rail.terminals().map((terminal) => terminal.id));
    const roots = untrack(fromRoot);

    // An acknowledged opening survives absent lists until a list has actually included it.
    const retained = roots.filter(root => !root.listed || listed.has(root.id))
      .map(root => !root.listed && listed.has(root.id) ? { ...root, listed: true } : root);

    if (retained.length !== roots.length || retained.some((root, index) => root !== roots[index])) setFromRoot(retained);
    const prior = untrack(places);
    const kept = Object.fromEntries(Object.entries(prior).filter(([id]) => listed.has(id)));

    if (Object.keys(kept).length !== Object.keys(prior).length) {
      setPlaces(kept);
      persistPlaces(kept);
    }
  });

  // The layer shrinks when the Shelf opens or the window narrows: every place is kept inside it (U164).
  createEffect(() => {
    const host = layer();

    if (!host || typeof ResizeObserver === "undefined") return;

    // U4459: controls can extend outside the strip; the bar and its portalled tabs own the edge.
    const watched = new ResizeObserver(() => sync());
    let edges: Element[] = [];

    const sync = (): void => {
      const parent = host.parentElement;
      setBar(parent?.querySelector<HTMLElement>(".resource-agent") ?? undefined);
      const stack = parent?.getBoundingClientRect();

      const controls = [...parent?.querySelectorAll(".resource-agent, .terminal-tabs") ?? []]
        .filter(element => element.querySelector("button, input, [role=tab]"));

      const boxes = controls.flatMap(element => {
        const box = element.getBoundingClientRect();

        return box.width > 0 && box.height > 0 ? [box] : [];
      });

      const siblings = boxes.length ? boxes : [...parent?.querySelectorAll(".hint-line, .resource-strip, .thread-composer") ?? []]
        .flatMap(element => {
          const box = element.getBoundingClientRect();

          return box.width > 0 && box.height > 0 ? [box] : [];
        });

      const nextEdges = [...controls, ...parent?.querySelectorAll(".hint-line, .resource-strip, .thread-composer") ?? []];

      for (const edge of edges) if (!nextEdges.includes(edge)) watched.unobserve(edge);

      for (const edge of nextEdges) if (!edges.includes(edge)) watched.observe(edge);
      edges = nextEdges;
      const tops = siblings.map(box => box.top);
      host.style.bottom = stack ? `${Math.max(0, stack.bottom - Math.min(stack.bottom, ...tops))}px` : "";

      const corner = host.getBoundingClientRect();
      setOrigin((prior) => (prior.left === corner.left && prior.top === corner.top && prior.width === corner.width && prior.height === corner.height ? prior : { left: corner.left, top: corner.top, width: corner.width, height: corner.height }));

      // Do not replace a saved rectangle with fallback geometry before layout exists.
      if (corner.width <= 0 || corner.height <= 0) return;
      const prior = untrack(places);
      const next = Object.fromEntries(Object.entries(prior).map(([id, place]) => [id, clamped(place, extent())]));

      if (JSON.stringify(next) !== JSON.stringify(prior)) {
        setPlaces(next);
        persistPlaces(next);
      }

      setMeasured(true);
    };

    watched.observe(host);
    window.addEventListener("resize", sync);
    onCleanup(() => window.removeEventListener("resize", sync));

    if (host.parentElement) watched.observe(host.parentElement);

    // Portal hosts and sibling controls may mount without changing the stack's size.
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

  const { close, closing, Failure: CloseFailure, reportFailure, mounted } = createTerminalClose(connected, shown, nameFor, (message, terminal) => setFailure(message === null ? null : { message, terminal: terminal ?? null }), clearItemFailure, failure);

  const focusItem = (id: string) => focusBubble(id, places()[id], props.screens);

  let generation = 0;

  const toggleMinimised = (id: string, wasMin = placeOf(id).min): void => {
    const focus = captureFocus(true);
    const place = { ...placeOf(id), min: wasMin };

    if (place.min) show(id);
    else setPlace(id, { ...place, min: true });
    const revision = generation;

    // A later pointer press supersedes the focus queued by this tab.
    queueMicrotask(() => { if (generation === revision) focus(() => focusItem(id)); });
  };

  const closeFocused = (focus: Element | null): void => closeBubble(focus, before, async id => {
    await close(id);

    return failure() === null && !shown().some(terminal => terminal.id === id);
  });

  const terminalOwner = () => resolvedWorkstream(rail.nodes, rail.selected()) ?? siblingsOf(rail.nodes, null).find(isWorkstream)?.id ?? null;

  /** The id `terminal.open` answered, else null when there was nothing to open or the call failed. */
  const openTerminal = async (current = () => true, focus = true, home = terminalOwner()): Promise<string | null> => {
    const workstream = home;
    const selection = rail.selected();

    if (opening() || readOnly()) return null;
    const opener = document.activeElement;
    let focusReturn = captureFocus(true);
    setOpeningSelection(selection);
    setOpening(true);
    const key = crypto.randomUUID();
    const destination = Promise.withResolvers<{ host: HTMLElement; settled: () => boolean }>();
    const controller = new AbortController();
    openingController = controller;
    destinations.set(key, destination.resolve);
    setReserved(prior => ({ ...prior, [key]: null }));
    let prepared: Awaited<ReturnType<Screens["prepare"]>> | undefined;

    const cancelled = () => {
      const host = bubbleElement(key);
      const restore = focus && rail.selected() === selection && host?.contains(document.activeElement);
      setPlace(key, { ...placeOf(key), min: true });

      if (restore) captureFocus(true)(() => {
        if (opener instanceof HTMLElement && opener.isConnected && opener !== document.body) opener.focus();
        else document.querySelector<HTMLElement>(".terminal-new")?.focus({ preventScroll: true });
      });
    };

    controller.signal.addEventListener("abort", cancelled, { once: true });

    try {
      const target = mounted() ? await destination.promise : null;

      if (focus && target && focusReturn(() => target.host.closest(".bubble")?.querySelector<HTMLElement>(".bubble-controls button")?.focus({ preventScroll: true }))) focusReturn = captureFocus();
      prepared = target ? await props.screens.prepare(target.host, target.settled, controller.signal) : undefined;

      if ((focus && !current()) || rail.selected() !== selection) return null;
      const opened = await app.rpc("terminal.open", { workstream, ...prepared?.size });

      if (controller.signal.aborted && controller.signal.reason?.message === copy.terminalPreparationCancelled) {
        await app.rpc("terminal.close", { id: opened.terminal_id });
        await rail.refresh({ terminals: true });

        return null;
      }

      prepared?.bind(opened.terminal_id);
      setPlaces(prior => ({ ...prior, [opened.terminal_id]: placeOf(key) }));
      const available = () => mounted() && !controller.signal.aborted && current() && rail.selected() === selection;

      if (available()) {
        setFromRoot(prior => selection === null ? [...prior, { id: opened.terminal_id, listed: rail.terminals().some(terminal => terminal.id === opened.terminal_id) }] : []);

        if (selection !== null && (workstream === null || resolvedWorkstream(rail.nodes, selection) !== workstream)) setOpenedHere(prior => [...prior, opened.terminal_id]);
      } else setPlace(opened.terminal_id, { ...placeOf(opened.terminal_id), min: true });
      setFailure(prior => prior?.terminal === null ? null : prior);
      rail.commandFailure.acknowledge(null);
      await rail.refresh({ terminals: true });
      setReserved(prior => ({ ...prior, [key]: opened.terminal_id }));

      if (available() && focus) setWanted({ id: opened.terminal_id, focus: focusReturn });

      if (available()) {
        if (!focus) show(opened.terminal_id);
      } else {
        setWanted(prior => prior?.id === opened.terminal_id ? null : prior);
        setPlace(opened.terminal_id, { ...placeOf(opened.terminal_id), min: true });
      }

      return opened.terminal_id;
    } catch (thrown) {
      if (!(thrown instanceof Error)) throw thrown;

      if (prepared || !controller.signal.aborted) reportFailure(thrown, copy.newTerminal, undefined, () => {
        if (workstream !== null && !rail.nodes.some(node => node.id === workstream && node.kind === "workstream")) {
          rail.commandFailure.show(copy.terminalOriginalWorkstreamUnavailable);

          return;
        }

        if (outcomeOf(thrown) === "failed") void openTerminal(() => false, false, workstream);
        else void app.ask({ title: copy.newTerminal, message: copy.terminalOpenAgainQuestion, okLabel: copy.newTerminal, cancelLabel: copy.keep }).then(accepted => { if (accepted) void openTerminal(() => false, false, workstream); });
      });

      return null;
    } finally {
      if (openingController === controller) openingController = undefined;
      controller.signal.removeEventListener("abort", cancelled);
      controller.abort();
      prepared?.dispose();
      destinations.delete(key);

      if (reserved()[key] === null) setReserved(prior => {
        const next = { ...prior };
        delete next[key];

        return next;
      });
      setOpening(false);

      if (mounted() && focus && failure() !== null && shown().length === 0) focusReturn(() => document.querySelector<HTMLElement>(".terminal-new")?.focus({ preventScroll: true }));
    }
  };

  useCreation("terminal", home => {
    void openTerminal(() => true, true, home);
  });

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
    let selection: string | null = null;
    let target: EventTarget | null = null;
    let pointerId: number | undefined;
    let disposed = false;
    let openedId: string | null = null;

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

    const cancel = (): void => {
      if (press === null) return;
      generation += 1;

      if (active) {
        swallowMenu = true;
        swallowUp = true;
      }

      end();
      id = null;
      openedId = null;
    };

    onCleanup(() => { disposed = true; cancel(); });
    createEffect(on(() => rail.selected(), () => { generation += 1; cancel(); }, { defer: true }));

    const blocked = (): boolean =>
      resolvedWorkstream(rail.nodes, rail.selected()) === null || opening() || readOnly() || surfaceOpen();

    const start = (): void => {
      active = true;

      const target = lastTarget();

      if (target !== null) {
        id = target;
        holdAt(target, pointer);

        return;
      }

      id = null;
      const request = generation;
      const selected = selection;
      const current = () => !disposed && generation === request && rail.selected() === selected;

      void openTerminal(current, false).then((opened) => {
        if (opened === null || !current()) return;

        id = opened;
        // Release retains its final pointer, cancellation invalidates this request.
        holdAt(opened, pointer);

        if (press === null) focusItem(opened);
        else openedId = opened;
      });
    };

    const down = (event: PointerEvent): void => {
      cancel();
      generation += 1;
      openedId = null;
      swallowMenu = false;
      swallowUp = false;
      press = null;

      if (event.pointerType !== "mouse" || event.button !== 2 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || textTarget(event.target) || blocked()) return;

      selection = rail.selected();
      target = event.target;
      pointerId = event.pointerId;
      press = { x: event.clientX, y: event.clientY };
      pointer = press;
    };

    const move = (event: PointerEvent): void => {
      if (press === null || (event.pointerId !== undefined && event.pointerId !== pointerId)) return;

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
      if (press === null || (event.pointerId !== undefined && event.pointerId !== pointerId)) return;

      if (active) {
        event.stopPropagation();
        swallowMenu = true;
        swallowUp = true;
      }

      end();

      if (openedId !== null) focusItem(openedId);
      openedId = null;
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
    listen("pointercancel", event => { if (event.pointerId === undefined || event.pointerId === pointerId) cancel(); });
    listen("blur", event => { if (event.target === event.currentTarget) cancel(); });
    listen("focusin", event => { if (press !== null && event.target !== target) cancel(); });
    listen("mousemove", swallow);
    listen("mouseup", swallowRelease);
    listen("contextmenu", menu);
    registerKeys({ kind: "app" }, [{
      chords: ESCAPE,
      when: () => active,
      run: () => {
        swallowMenu = true;
        cancel();
      },
    }]);
  };

  pulling();

  // The bubble the user opened takes the keys, whether its Terminal is listed before or after `terminal.open` answers.
  createEffect(() => {
    const request = wanted();

    if (request === null || !shown().some((terminal) => terminal.id === request.id)) return;
    const { id, focus } = request;

    queueMicrotask(() => {
      if (wanted() !== request || bubbleElement(id) === null) return;

      if (!focus(() => { show(id); focusItem(id); })) setPlace(id, { ...placeOf(id), min: true });

      if (wanted() === request) setWanted(null);
    });
  });

  // U511: the name's editor owns its keys. Help and the Switcher are modal layers, so no chord acts under them (U54); a pressed key repeats nothing.
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
          const permission = captureFocus(true);
          show(target);
          // The manual popover becomes focusable when Solid commits this turn's visibility change.
          queueMicrotask(() => permission(() => {
            if (focus?.isConnected && !readOnly() && rail.selected() === selected && mainTerminal() === main && shown().some((terminal) => terminal.id === target) && !closing().has(target!) && !placeOf(target!).min) props.screens.emulatorFor(target!).focus();
          }));
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

  const onBubbleFocus = (event: FocusEvent): void => trackBubbleFocus(event, id => { lastFocused = id; });

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

    const focus = captureFocus(true);
    show(id);
    queueMicrotask(() => focus(() => focusItem(id)));
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
      if (terminal().incarnation !== destination.object || !terminal().running || readOnly()) setEditing(prior => prior?.id === id ? null : prior);
    });

    const tab = () => document.querySelector<HTMLElement>(`button.terminal-tab[data-bubble="${id}"]`);

    /** U2694b: the tab and Bubble share actions and the same rename editor. */
    const copied = createCopyFeedback();
    createEffect(on(() => terminal().incarnation, copied.reset));

    const tabMenu = (x: number, y: number) => {
      const agents = rail.nodes;
      const target = terminal();

      return contextMenu(app, [
        { id: "rename", label: copy.rename, run: start },
        ...linkEntries(app, { kind: "terminal", id: id }, agents, (node) => rail.exitOf(node) === null, message => setFailure({ message, terminal: target }), () => clearItemFailure(target), copied),
        { id: "close", label: copy.close, shortcut: lastTarget() === id ? copy.closeChord : undefined, run: () => close(id) },
      ], x, y);
    };

    const menu = (event: MouseEvent) => openOnRelease(event, (x, y) => void tabMenu(x, y));
    bubbleMenus.set(id, menu);
    onCleanup(() => bubbleMenus.delete(id));

    return <>
      <FlatTab class="terminal-tab-pair" onContextMenu={menu} selected={!placeOf(id).min} data-bubble={id}>
        <Show when={editing()?.id === id ? editing() : null} keyed fallback={
          <Tip content={tabLabel(name(), terminal().status)} cut={() => nameCut() || !!terminal().status}>
            {(trigger) => (
              <button {...trigger()} type="button" data-button="quiet" data-reads={!placeOf(id).min ? "text" : undefined} class="terminal-tab" data-bubble={id}
                aria-label={tabLabel(name(), terminal().status)} aria-describedby={!terminal().status && props.screens.unseen(id) ? `terminal-state-${id}` : undefined} aria-pressed={!placeOf(id).min}
                onClick={() => toggleMinimised(id)}
                onDblClick={() => start()}>
                <span class="terminal-tab-name" ref={nameRef}>{copied.copied() ? copy.copied : name()}</span>
                <span class="terminal-tab-slot"><Show when={terminal().status} fallback={<Show when={props.screens.unseen(id)}><span id={`terminal-state-${id}`} class="terminal-tab-unseen" data-state="" role="img" aria-label={copy.unseenOutput} /></Show>}>{status => <ProgramStatusMark status={status()} />}</Show></span>
              </button>
            )}
          </Tip>
        }>{_edit =>
          <div class="terminal-tab terminal-tab-editor" data-bubble={id} data-pressed={!placeOf(id).min}>
            <Editable.Root selectOnFocus={false} defaultValue={initial} activationMode="none" submitMode={requiresConfirmation() || (restored === "current" && !changed()) ? "enter" : "both"} finalFocusEl={tab}
              onValueCommit={async ({ value }) => {
                const submitted = revision;
                const live = rail.terminals().find(candidate => candidate.incarnation === destination.object && candidate.id === id && candidate.running);

                if (!live || readOnly() || base !== nameFor(live)) {
                  openRecovery(tab);

                  return;
                }

                if (submitted && !(await drafts.submit(submitted))) {
                  openRecovery(tab);

                  return;
                }

                const failure = rename(live, value);

                if (submitted) drafts.settle(submitted, failure === null ? "acknowledged" : "failed");

                if (failure === null) clearItemFailure(live);
                else setFailure({ message: failure, terminal: live });

                if (failure !== null) openRecovery(tab);
              }}
              onEditChange={({ edit }) => { if (!edit) setEditing(null); }}>
              <Editable.Context>{(api) => {
                let cancelling = false;
                onMount(() => api().edit());

                return <Editable.Area><Editable.Preview /><Editable.Input spellcheck={false} autocorrect="off" autocapitalize="off" aria-label={copy.terminalName}
                on:keydown={event => {
                  if (event.key !== "Escape" || event.isComposing) return;

                  if (revision || event.currentTarget.value !== initial) capture(event.currentTarget);
                  // Ark blurs before onEditChange; cancellation must close through that callback.
                  cancelling = true;
                  event.preventDefault();
                  event.stopPropagation();
                  api().cancel();
                }}
                onBlur={() => { if (!cancelling && (requiresConfirmation() || (restored === "current" && !changed()))) setEditing(null); }}
                onInput={event => { change(true); capture(event.currentTarget); }}
                onSelect={event => { if (document.activeElement === event.currentTarget && revision) capture(event.currentTarget); }} ref={(input: HTMLInputElement) => {
                // Chromium's select() leaves focus where it was; the editor takes it, with the whole name selected, after the library's own step.
                const permission = captureFocus();
                onMount(() => requestAnimationFrame(() => permission(() => { if (!input.isConnected) return;
                  input.focus({ preventScroll: true });

                  if (selection) input.setSelectionRange(selection.start, selection.end, selection.direction);
                  else input.select(); })));
              }} /></Editable.Area>;
              }}</Editable.Context>
            </Editable.Root>
            <span class="terminal-tab-slot"><Show when={props.screens.unseen(id)}><span id={`terminal-state-${id}`} class="terminal-tab-unseen" data-state="" role="img" aria-label={copy.unseenOutput} /></Show></span>
          </div>}
        </Show>
        <IconButton aria-label={copy.closeTerminal(name())} onClick={() => void close(id)}><Icon name="x" /></IconButton>
      </FlatTab>
    </>;
  };

  const recoveryNotice = createMemo(() => shownDraft() ? !original(shownDraft()!) || readOnly() ? copy.originalUnavailable : shownDraft()!.value.base !== nameFor(original(shownDraft()!)!) ? copy.railDraftConflict : null : null);

  return <div class="bubbles" ref={setLayer}>
      <For each={[...Object.keys(reserved()).filter(key => reserved()[key] === null), ...shownIds().map(id => Object.keys(reserved()).find(key => reserved()[key] === id) ?? id)]}>{key => {
        const id = () => reserved()[key] ?? key;

        return <Bubble id={id()} preparing={reserved()[key] === null} hostRef={(host, settled) => destinations.get(key)?.({ host, settled })} screens={props.screens} name={shown().find(terminal => terminal.id === id()) ? nameFor(shown().find(terminal => terminal.id === id())!) : ""} place={placeOf(id())} origin={origin()} extent={extent} setPlace={setPlace} readOnly={readOnly} close={async terminal => { if (reserved()[key] === null) openingController?.abort(new DOMException(copy.terminalPreparationCancelled)); else await close(terminal); }} menu={event => bubbleMenus.get(id())?.(event)} toggleMinimised={terminal => { if (reserved()[key] === null) openingController?.abort(); else toggleMinimised(terminal); }} />;
      }}</For>
      {/* Keep Portal children alive while the tab host is absent; each Bubble portals to the document. */}
      <Portal mount={bar() ?? parkedTabs} ref={(element) => { element.classList.add("terminal-tabs-host"); element.setAttribute("data-flat-bar", ""); }}>
        <div class="terminal-tabs" role="group" aria-label={copy.terminals} onFocusIn={(event) => {
          if (event.target instanceof HTMLElement) event.target.scrollIntoView({ block: "nearest", inline: "nearest" });
        }}>
          <div class="terminal-tab-list"><For each={shownIds()}>{id => <Tab id={id} />}</For></div>
          <div class="terminal-tabs-actions">
            <Tip text={copy.newTerminal}>{trigger => <FlatAdd {...trigger()} data-button="add" class="terminal-new" aria-label={copy.newTerminal} onClick={() => void open()}><Icon name="plus" /></FlatAdd>}</Tip>
            <Show when={records().length || problem()}><IconButton class="terminal-recover" aria-label={copy.draftIdentity(copy.recoverDrafts, copy.terminalName)} onClick={() => openRecovery()}><Icon name="edit" /></IconButton></Show>
          </div>
        </div>
        <HintLine />
      </Portal>
      <Dialog.Root instant open={recovering()} onOpenChange={details => recover(details.open)}>
        <Portal><Dialog.Positioner asChild={positioner => <aside {...positioner({})} />}><Dialog.Content class="draft-recovery bubble-recovery" ref={element => { recoveryPanel = element; }}>
          <Dialog.Title asChild={title => <h2 {...title({})}>{copy.unfinishedWork}</h2>} />
          <Dialog.Description class="draft-identity">{copy.draftIdentity(connected.project.name, copy.terminalName)}</Dialog.Description>
          <ReservedLine message={(copyFailure()?.message) || (problem() ? (copy.draftRetention(connected.project.name, copy.terminalName, problem()!.cause)) : null) || null}><Show when={copyFailure()}><button data-button="quiet" class="word" type="button" onClick={() => failCopy(null)}>{copy.dismissFailure}</button></Show></ReservedLine>
          <Show when={records().length > 1}><For each={[...records()].reverse().sort((a, b) => Number(b.status === "draft") - Number(a.status === "draft"))}>{(draft, index) => <button type="button" data-button="quiet" aria-pressed={shownDraft()?.revision === draft.revision} onClick={() => inspect(draft.revision)}>{copy.draftIdentity(copy.inspectDraft, draft.status === "draft" ? copy.currentDraft : copy.draftStatus[draft.status], String(draft.value.base ?? ""), String(index() + 1))}</button>}</For></Show>
          <Show when={shownDraft()}>{draft => <>
            <p class="draft-identity">{copy.draftIdentity(String(draft().value.base ?? ""), draft().destination.recipient ?? copy.noDraftRecipient)}</p>
            <ReservedLine status={recoveryNotice() ?? copy.draftStatus[draft().status]} data-state={draft().status} />
            <pre class="draft-value">{String(draft().value.name ?? "")}</pre>
          </>}</Show>
          <div class="draft-actions">
            <Show when={shownDraft()}>{draft => <><CopyButton app={app} identity={draft().revision} text={String(draft().value.name ?? "")} onSuccess={() => failCopy(prior => prior?.revision === draft().revision ? null : prior)} onFailure={error => failCopy({ revision: draft().revision, message: copy.copyDraftFailure(error.message) })}>{copy.copyProjectName}</CopyButton>
            <button type="button" data-button="quiet" onClick={() => { drafts.discard(draft().revision); setEditing(null); }}>{copy.discardRevision}</button></>}</Show>
            <Show when={problem()}><button type="button" data-button="quiet" onClick={() => drafts.retry()}>{copy.storageRetry}</button></Show>
            <Dialog.CloseTrigger data-button="quiet">{copy.close}</Dialog.CloseTrigger>
          </div>
        </Dialog.Content></Dialog.Positioner></Portal>
      </Dialog.Root>
      <CloseFailure message={failure()?.message ?? null}><Show when={failure()?.terminal === null}><button data-button="quiet" class="word" type="button" onClick={() => { setFailure(null); void open(); }}>{copy.retry}</button></Show><button data-button="quiet" class="word" type="button" onClick={() => setFailure(null)}>{copy.dismissFailure}</button></CloseFailure>
    </div>;
};
