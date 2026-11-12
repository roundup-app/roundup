import { closeFocused as closeBubble, bubbleElement, focusedId, focusItem as focusBubble, onBubbleFocus as trackBubbleFocus, hasTerminalFocus } from "./focus";
import { outcomeOf } from "../app/seam";
import { captureFocus, focusTarget, provideFocusTarget } from "../keys/focus";
import { createTerminalClose } from "./close";
import { dismissable, ReservedLine } from "../ink/ReservedLine";
import { CHORDS, LEADER } from "../keys/chords";
import { registerKeys } from "../keys/registry";
import * as v from "valibot";
import { NameDraftRecovery } from "../drawer/NameDraftRecovery";
import { Editable } from "../ui/Editable";
import { FlatAdd, FlatTab } from "../ui/FlatTab";
import { IconButton } from "../ui/IconButton";
import { contextMenu, linkEntries, openOnRelease, textTarget, PULL_DISTANCE } from "../ui/contextMenu";
import { Bubble } from "./Bubble";
import { idle, step } from "./pull";
import type { Pull, Pressed, Pulling } from "./pull";
import { makeEventListener } from "@solid-primitives/event-listener";
import { Tab } from "./tab";
import type { TabContext } from "./tab";
import { copy } from "./copy";
import { createBubbleFailure, createCopyFailure } from "./failures";
import { createRestartable } from "../ink/restartable";
import { createEffect, createMemo, createSignal, For, on, onCleanup, onMount, Show, untrack } from "solid-js";
import { createBubblesModel, samePlaces } from "./model";
import type { Arrival } from "./model";
import { Portal } from "solid-js/web";
import { HintLine } from "../keys/HintLine";
import type { TerminalInfo } from "@contracts/terminal/TerminalInfo";
import { Icon } from "../ink/Icon";
import { createCut } from "../ink/Tip";
import { Tip } from "../ui/Tip";
import { surfaceOpen } from "../ui/openSurfaces";
import { isWorkstream, resolvedWorkstream, siblingsOf } from "../state/railTopology";
import { useConnectedProject, useCreation } from "../state/connectedProject";
import type { Screens } from "../terminal/screens";
import {
  clamped, defaultPlace, extentOf, placesStorage, REVEAL_BUBBLE, shownFor, shownName,
} from "./places";
import type { Place, Extent } from "./places";
import "./styles.css";

const ESCAPE = "Escape".split(" ");

const schema = v.strictObject({ name: v.string(), base: v.string(), recovery: v.optional(v.literal(true)) });

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
  drafts.validate("bubbles", schema);
  drafts.registerRecovery("bubbles", (draft, facts) => {
    return facts.daemonExit() !== null ? "unavailable" : facts.rail.failure() ? "unverified"
      : facts.rail.terminals().some(terminal => terminal.incarnation === draft.destination.object && terminal.id === draft.destination.recipient && terminal.running) ? "available" : "unavailable";
  });
  const records = createMemo(() => drafts.list().filter(draft => draft.destination.surface === "bubbles"));
  const [recovering, recover] = createSignal(false);
  const copyFailures = createCopyFailure(() => records().map(draft => draft.revision));
  const copyFailure = copyFailures.failure;
  const recoveryLine = dismissable(() => (copyFailure()) || (problem() ? (copy.draftRetention(connected.project.name, copy.terminalName, problem()!.cause)) : null) || null);
  const currentDraft = () => records().filter(draft => draft.status === "draft" && !draft.value.recovery).at(-1);

  const problem = () => {
    const failure = drafts.problem();

    return failure?.destination && failure.destination.surface !== "bubbles" ? null : failure;
  };

  const original = (draft: ReturnType<typeof drafts.list>[number]) => rail.terminals().find(terminal => terminal.incarnation === draft.destination.object && terminal.id === draft.destination.recipient && terminal.running);
  let recoveryPanel: HTMLDivElement | undefined;
  registerKeys({ kind: "layer", element: () => recoveryPanel, active: recovering, modal: true }, []);

  const model = createBubblesModel(store, () => connected.daemonExit() === null);
  const { places, commitPlaces, wanted, setWanted, reserved } = model;

  const refreshPlaces = (event: StorageEvent) => {
    if (event.storageArea === window.sessionStorage && event.key === `roundup:bubble-places:${path}`) model.reload();
  };

  window.addEventListener("storage", refreshPlaces);
  onCleanup(() => window.removeEventListener("storage", refreshPlaces));

  const failures = createBubbleFailure(() => connected.daemonExit() !== null ? "unknown" : rail.terminals());
  const { failure, set: setFailure } = failures;

  const clearItemFailure = (terminal: { id: string; incarnation: string }) => {
    rail.commandFailure.acknowledgeTerminal(terminal);
    failures.clearTerminal(terminal);
  };

  const bubbleMenus = new Map<string, (event: MouseEvent) => void>();
  const opening = () => model.opening().kind === "opening";

  const abortOpening = (reason?: DOMException): void => {
    const current = untrack(model.opening);

    if (current.kind === "opening") current.controller.abort(reason);
  };

  onCleanup(() => abortOpening());
  createEffect(on(rail.selected, () => abortOpening(), { defer: true }));
  const [layer, setLayer] = createSignal<HTMLElement>();
  const [bar, setBar] = createSignal<HTMLElement>();
  const parkedTabs = document.createElement("div");
  const [measured, setMeasured] = createSignal(false);
  const [origin, setOrigin] = createSignal({ left: 0, top: 0, width: 0, height: 0 });
  const [editing, setEditing] = createRestartable<{ id: string } | null>(rail.selected, null);
  onMount(() => setBar(layer()?.parentElement?.querySelector<HTMLElement>(".resource-agent") ?? undefined));
  let before: Element | null = null;

  const extent = (): Extent => extentOf(layer());

  // U524: every Terminal opened from the Project root stays available alongside Project-owned Terminals.
  const [fromRoot, setFromRoot] = createSignal<readonly { id: string; listed: boolean }[]>([]);
  const [openedHere, setOpenedHere] = createRestartable<readonly string[]>(rail.selected, []);

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

    const current = model.opening();
    const selecting = current.kind === "opening" && chosen === current.selection;

    for (const terminal of missing) next[terminal.id] = { ...defaultPlace(untrack(extent)), min: selecting || terminal.id !== latest };

    for (const terminal of visible) next[terminal.id] = { ...next[terminal.id]!, min: terminal.id !== latest };

    if (folds) for (const terminal of eligible) next[terminal.id] = { ...next[terminal.id]!, min: true };

    if (!samePlaces(next, prior)) commitPlaces(next);
  });

  const setPlace = (id: string, place: Place): void => {
    commitPlaces({ ...places(), [id]: place });
  };

  const nameFor = (terminal: TerminalInfo): string => shownName(terminal, places()[terminal.id]);

  /** U511: a trimmed name that differs from the shown one is saved on the Terminal's place; an empty one clears it. */
  const rename = (terminal: TerminalInfo, value: string): string | null => {
    const name = value.trim();

    if (name === nameFor(terminal) || (name === "" && places()[terminal.id]?.name === undefined)) return null;

    const { name: _previous, ...place } = placeOf(terminal.id);

    return model.commitRename({ ...places(), [terminal.id]: name === "" ? place : { ...place, name } });
  };

  const show = (id: string | null): void => {
    if (id !== null && !shown().some((terminal) => terminal.id === id)) return;

    const next = { ...places() };

    for (const terminal of shown()) next[terminal.id] = { ...placeOf(terminal.id), min: terminal.id !== id };
    commitPlaces(next);
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

    if (Object.keys(kept).length !== Object.keys(prior).length) commitPlaces(kept);
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

      if (!samePlaces(next, prior)) commitPlaces(next);

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
    const destination = Promise.withResolvers<Arrival>();
    const begun = model.open(selection, destination.resolve);

    if (begun === null) return null;
    const { key, controller } = begun;
    let prepared: Awaited<ReturnType<Screens["prepare"]>> | undefined;

    const cancelled = () => {
      const host = bubbleElement(key);
      const restore = focus && rail.selected() === selection && host?.contains(document.activeElement);
      setPlace(key, { ...placeOf(key), min: true });

      if (restore) captureFocus(true)(() => {
        if (opener instanceof HTMLElement && opener.isConnected && opener !== document.body) opener.focus();
        else focusTarget("terminal.new")?.focus({ preventScroll: true });
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
      commitPlaces({ ...places(), [opened.terminal_id]: placeOf(key) });
      const available = () => mounted() && !controller.signal.aborted && current() && rail.selected() === selection;

      if (available()) {
        setFromRoot(prior => selection === null ? [...prior, { id: opened.terminal_id, listed: rail.terminals().some(terminal => terminal.id === opened.terminal_id) }] : []);

        if (selection !== null && (workstream === null || resolvedWorkstream(rail.nodes, selection) !== workstream)) setOpenedHere(prior => [...prior, opened.terminal_id]);
      } else setPlace(opened.terminal_id, { ...placeOf(opened.terminal_id), min: true });
      failures.clearGeneral();
      rail.commandFailure.acknowledge(null);
      await rail.refresh({ terminals: true });
      model.reserve(key, opened.terminal_id);

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
      controller.signal.removeEventListener("abort", cancelled);
      controller.abort();
      prepared?.dispose();
      model.finish(key);

      if (mounted() && focus && failure() !== null && shown().length === 0) focusReturn(() => focusTarget("terminal.new")?.focus({ preventScroll: true }));
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
    let pull: Pull = idle();
    let disposed = false;

    const apply = (running: Pulling): void => {
      running.frame = null;

      if (running.id !== null) holdAt(running.id, running.pointer);
    };

    const schedule = (running: Pulling): void => {
      running.frame ??= requestAnimationFrame(() => apply(running));
    };

    /** Leaves the running Pull; a queued frame lands first, so the bubble stays where the last move put it. */
    const leave = (event: "release" | "cancel"): Pulling | null => {
      const was = pull;

      if (was.kind === "idle") return null;
      pull = step(was, { type: event });

      if (was.kind !== "pulling") return null;

      if (was.frame !== null) {
        cancelAnimationFrame(was.frame);
        apply(was);
      }

      return was;
    };

    const cancel = (): void => {
      if (pull.kind === "idle") return;
      generation += 1;
      leave("cancel");
    };

    onCleanup(() => { disposed = true; cancel(); });
    createEffect(on(() => rail.selected(), () => { generation += 1; cancel(); }, { defer: true }));

    const blocked = (): boolean =>
      resolvedWorkstream(rail.nodes, rail.selected()) === null || opening() || readOnly() || surfaceOpen();

    const start = (pressed: Pressed): void => {
      const running = step(pressed, { type: "start" });

      pull = running;

      if (running.kind !== "pulling") return;

      const target = lastTarget();

      if (target !== null) {
        running.id = target;
        holdAt(target, running.pointer);

        return;
      }

      const request = generation;
      const selected = running.selection;
      const current = () => !disposed && generation === request && rail.selected() === selected;

      void openTerminal(current, false).then((opened) => {
        if (opened === null || !current()) return;

        running.id = opened;
        // Release retains its final pointer, cancellation invalidates this request.
        holdAt(opened, running.pointer);

        if (pull === running) running.openedId = opened;
        else focusItem(opened);
      });
    };

    const down = (event: PointerEvent): void => {
      cancel();
      generation += 1;
      pull = step(pull, { type: "clear" });

      if (event.pointerType !== "mouse" || event.button !== 2 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || textTarget(event.target) || blocked()) return;

      pull = step(pull, { type: "press", press: { x: event.clientX, y: event.clientY }, selection: rail.selected(), target: event.target, pointerId: event.pointerId });
    };

    const mine = (event: PointerEvent): boolean =>
      pull.kind !== "idle" && (event.pointerId === undefined || event.pointerId === pull.pointerId);

    const move = (event: PointerEvent): void => {
      if (pull.kind === "idle" || !mine(event)) return;

      pull.pointer = { x: event.clientX, y: event.clientY };

      if (pull.kind === "pressed") {
        if ((event.buttons & 2) === 0 || Math.hypot(pull.pointer.x - pull.press.x, pull.pointer.y - pull.press.y) < PULL_DISTANCE) return;

        start(pull);
      }

      // A Pull crossing a Terminal keeps its move and release out of that program.
      event.stopPropagation();

      if (pull.kind === "pulling" && pull.id !== null) schedule(pull);
    };

    const up = (event: PointerEvent): void => {
      if (!mine(event)) return;

      if (pull.kind === "pulling") event.stopPropagation();

      const was = leave("release");

      if (was?.openedId != null) focusItem(was.openedId);
    };

    const swallow = (event: Event): void => {
      if (pull.kind === "pulling") event.stopPropagation();
    };

    const swallowRelease = (event: Event): void => {
      if (pull.kind !== "pulling" && !(pull.kind === "idle" && pull.swallowUp)) return;

      pull = step(pull, { type: "mouseup" });
      event.stopPropagation();
    };

    const menu = (event: Event): void => {
      if (pull.kind !== "pulling" && !(pull.kind === "idle" && pull.swallowMenu)) return;

      pull = step(pull, { type: "menu" });
      event.preventDefault();
      event.stopPropagation();
    };

    makeEventListener(window, "pointerdown", down, true);
    makeEventListener(window, "pointermove", move, true);
    makeEventListener(window, "pointerup", up, true);
    makeEventListener(window, "pointercancel", event => { if (event.pointerId === undefined || mine(event)) cancel(); }, true);
    makeEventListener(window, "blur", event => { if (event.target === event.currentTarget) cancel(); }, true);
    makeEventListener(window, "focusin", event => { if (pull.kind !== "idle" && event.target !== pull.target) cancel(); }, true);
    makeEventListener(window, "mousemove", swallow, true);
    makeEventListener(window, "mouseup", swallowRelease, true);
    makeEventListener(window, "contextmenu", menu, true);
    registerKeys({ kind: "app" }, [{
      chords: ESCAPE,
      when: () => pull.kind === "pulling",
      run: cancel,
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
    { action: CHORDS["terminal.new"],
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

    return id !== null && focusTarget("pane.terminal") ? id : null;
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
    action: CHORDS["terminal.switch"],
    when: () => hasTerminalFocus(document.activeElement),
    capture: switchPair,
  }]);

  const hasFocusedBubble = (focus: Element | null): boolean => {
    const id = focusedId(focus);

    return focus?.isConnected === true && id !== null && shown().some((terminal) => terminal.id === id) && !readOnly() && !closing().has(id);
  };

  registerKeys({ kind: "leader" }, [
    { action: LEADER["leader.bubble-minimise"], capture: (focus) => {
      const id = focusedId(focus);
      const wasMin = id !== null && placeOf(id).min;

      return { available: () => hasFocusedBubble(focus), invoke: () => toggleMinimised(id!, wasMin) };
    } },
    { action: LEADER["leader.bubble-close"], capture: (focus) => ({ available: () => hasFocusedBubble(focus), invoke: () => closeFocused(focus) }) },
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

  const bubbleKeys = createMemo(() => {
    const { preparing, keyOf } = model.reservations();

    return [...preparing, ...shownIds().map(id => keyOf.get(id) ?? id)];
  });

  const tabContext: TabContext = {
    props, connected, schema, path, drafts, records, editing, setEditing, shown, nameFor, placeOf, toggleMinimised, openRecovery, readOnly, rename,
    setFailure, clearItemFailure, lastTarget, close, bubbleMenus,
  };

  const recoveryNotice = (draft: ReturnType<typeof records>[number]) => !original(draft) || readOnly() ? copy.originalUnavailable : draft.value.base !== nameFor(original(draft)!) ? copy.railDraftConflict : null;

  return <div class="bubbles" ref={setLayer}>
      <For each={bubbleKeys()}>{key => {
        const id = () => reserved()[key] ?? key;

        return <Bubble id={id()} preparing={reserved()[key] === null} hostRef={(host, settled) => model.arrive(key, { host, settled })} screens={props.screens} name={shown().find(terminal => terminal.id === id()) ? nameFor(shown().find(terminal => terminal.id === id())!) : ""} place={placeOf(id())} origin={origin()} extent={extent} setPlace={setPlace} readOnly={readOnly} close={terminal => reserved()[key] === null ? Promise.resolve(abortOpening(new DOMException(copy.terminalPreparationCancelled))) : close(terminal)} menu={event => bubbleMenus.get(id())?.(event)} toggleMinimised={terminal => { if (reserved()[key] === null) abortOpening(); else toggleMinimised(terminal); }} />;
      }}</For>
      {/* Keep Portal children alive while the tab host is absent; each Bubble portals to the document. */}
      <Portal mount={bar() ?? parkedTabs} ref={(element) => { element.classList.add("terminal-tabs-host"); element.setAttribute("data-flat-bar", ""); }}>
        <div class="terminal-tabs" role="group" aria-label={copy.terminals} onFocusIn={(event) => {
          if (event.target instanceof HTMLElement) event.target.scrollIntoView({ block: "nearest", inline: "nearest" });
        }}>
          <div class="terminal-tab-list"><For each={shownIds()}>{id => <Tab id={id} ctx={tabContext} />}</For></div>
          <div class="terminal-tabs-actions">
            <Tip text={copy.newTerminal}>{trigger => <FlatAdd {...trigger()} ref={element => provideFocusTarget("terminal.new", element)} data-button="add" class="terminal-new" aria-label={copy.newTerminal} onClick={() => void open()}><Icon name="plus" /></FlatAdd>}</Tip>
            <Show when={records().length || problem()}><IconButton class="terminal-recover" aria-label={copy.draftIdentity(copy.recoverDrafts, copy.terminalName)} onClick={() => openRecovery()}><Icon name="edit" /></IconButton></Show>
          </div>
        </div>
        <HintLine />
      </Portal>
      <NameDraftRecovery class="bubble-recovery" open={recovering()} onOpenChange={recover} panel={element => { recoveryPanel = element; }}
        identity={copy.draftIdentity(connected.project.name, copy.terminalName)} records={records()} current={currentDraft()} app={app}
        lines={<ReservedLine message={recoveryLine.message()} dismiss={() => copyFailure() !== undefined ? copyFailures.dismiss() : recoveryLine.dismiss()} recover={problem() ? { run: () => drafts.retry(), label: copy.storageRetry } : undefined} />}
        label={(draft, index) => copy.draftIdentity(copy.inspectDraft, draft.status === "draft" ? copy.currentDraft : copy.draftStatus[draft.status], String(draft.value.base ?? ""), String(index + 1))}
        detail={draft => <p class="draft-identity">{copy.draftIdentity(String(draft.value.base ?? ""), draft.destination.recipient ?? copy.noDraftRecipient)}</p>}
        notice={draft => <ReservedLine status={recoveryNotice(draft) ?? copy.draftStatus[draft.status]} data-state={draft.status} />}
        value={draft => String(draft.value.name ?? "")}
        onCopySuccess={draft => copyFailures.clear(draft.revision)}
        onCopyFailure={(draft, error) => copyFailures.fail(draft.revision, copy.copyDraftFailure(error.message))}
        onDiscard={draft => { drafts.discard(draft.revision); setEditing(null); }} />
      <CloseFailure message={failure()?.message ?? null} onDismiss={() => setFailure(null)} action={<Show when={failure()?.terminal === null}><button data-button="quiet" class="word" type="button" onClick={() => { setFailure(null); void open(); }}>{copy.retry}</button></Show>} />
    </div>;
};
