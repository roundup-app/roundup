import { createEffect, createMemo, createSignal, For, on, onCleanup, Show, untrack } from "solid-js";
import type { TerminalInfo } from "@contracts/terminal/TerminalInfo";
import { ErrorLine } from "../ink/ErrorLine";
import { Icon } from "../ink/Icon";
import { resolvedWorkstream } from "../rail/layout";
import { useConnectedProject } from "../state/connectedProject";
import type { Screens } from "../terminal/screens";
import {
  clamped, defaultPlace, DEFAULT_TRANSPARENCY, MAX_TRANSPARENCY, MIN_HEIGHT, MIN_WIDTH, nameOf, placesStorage, shownFor, STEP, TRANSPARENCY_STEP, transparencyStorage,
} from "./places";
import type { Place, Extent } from "./places";
import "./styles.css";

const FALLBACK_EXTENT: Extent = { width: 800, height: 600 };

const focusPane = (): void => document.querySelector<HTMLElement>(".pane-screen textarea, .pane-screen [tabindex]")?.focus();

const ARROWS = new Map<string, [number, number]>(Object.entries({ ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }));

/** U164, U165: the Terminals the selection shows, floating over the centre pane, and the keys that open, cycle, fold and close them. */
export const Bubbles = (props: { screens: Screens }) => {
  const connected = useConnectedProject();
  const { rail, app } = connected;
  const path = connected.project.path;
  const store = placesStorage(path);
  const transparencyStore = transparencyStorage(path);
  const [places, setPlaces] = createSignal<Record<string, Place>>(store.read());
  const [transparency, setTransparency] = createSignal(transparencyStore.read() ?? DEFAULT_TRANSPARENCY);
  const [failure, setFailure] = createSignal<string | null>(null);
  const [opening, setOpening] = createSignal(false);
  const [wanted, setWanted] = createSignal<string | null>(null);
  const [layer, setLayer] = createSignal<HTMLElement>();
  const closing = new Set<string>();
  let before: Element | null = null;

  const extent = (): Extent => {
    const box = layer()?.getBoundingClientRect();

    return box && box.width > 0 && box.height > 0 ? { width: box.width, height: box.height } : FALLBACK_EXTENT;
  };

  const shown = createMemo(() => shownFor(rail.terminals(), rail.nodes, rail.selected()));

  const placeOf = (id: string): Place => places()[id] ?? defaultPlace(Object.keys(places()).length, extent());

  const setPlace = (id: string, place: Place): void => {
    const next = { ...places(), [id]: place };

    setPlaces(next);
    store.write(next);
  };

  // A place for an id the Daemon no longer lists is forgotten (engineering call 2), and so is every place once the Daemon is gone.
  createEffect(() => {
    if (connected.daemonExit() !== null) {
      setPlaces({});
      store.clear();

      return;
    }

    const listed = new Set(rail.terminals().map((terminal) => terminal.id));
    const held = untrack(places);
    const kept = Object.fromEntries(Object.entries(held).filter(([id]) => listed.has(id)));

    if (Object.keys(kept).length !== Object.keys(held).length) {
      setPlaces(kept);
      store.write(kept);
    }
  });

  const readOnly = () => connected.daemonExit() !== null;

  const setLevel = (value: number): void => {
    setTransparency(value);
    setFailure(transparencyStore.write(value));
  };

  const running = (terminal: TerminalInfo): boolean => terminal.running && rail.terminalExit(terminal.id) === null;

  const stateText = (terminal: TerminalInfo): string => {
    const exit = rail.terminalExit(terminal.id);

    if (running(terminal)) return "running";

    return exit?.kind === "code" ? `exit ${exit.code}` : exit?.kind === "signal" ? "exit signal" : `exit ${terminal.exit_code ?? "?"}`;
  };

  const close = async (id: string): Promise<void> => {
    if (closing.has(id)) return;

    closing.add(id);

    try {
      await app.rpc("terminal.close", { id });
      await rail.refresh({ terminals: true });
      setFailure(null);
    } catch (thrown) {
      if (!(thrown instanceof Error)) throw thrown;

      setFailure(thrown.message);
    } finally {
      closing.delete(id);
    }
  };

  const bubbleElement = (id: string): HTMLElement | null => document.querySelector<HTMLElement>(`[data-bubble="${id}"]`);

  const focusItem = (id: string): void => {
    const place = places()[id];

    if (place?.min) document.querySelector<HTMLElement>(`.bubble-chip[data-bubble="${id}"]`)?.focus();
    else props.screens.emulatorFor(id).focus();
  };

  const focusedId = (): string | null => {
    const active = document.activeElement;

    return active instanceof Element ? (active.closest<HTMLElement>("[data-bubble]")?.dataset.bubble ?? null) : null;
  };

  const cycle = (direction: 1 | -1): void => {
    const ids = shown().map((terminal) => terminal.id);

    if (ids.length === 0) return;

    const at = focusedId();
    const index = at === null ? 0 : ids.indexOf(at) + 1;
    const next = (index + direction + ids.length + 1) % (ids.length + 1);

    if (next === 0) focusPane();
    else focusItem(ids[next - 1]!);
  };

  const toggleMinimised = (id: string): void => {
    const place = placeOf(id);

    setPlace(id, { ...place, min: !place.min });
    queueMicrotask(() => focusItem(id));
  };

  const closeFocused = (): void => {
    const id = focusedId();

    if (id === null) return;

    const back = before;

    void close(id).then(() => {
      if (failure() !== null) return;

      if (back instanceof HTMLElement && back.isConnected) back.focus();
      else focusPane();
    });
  };

  const open = async (): Promise<void> => {
    const workstream = resolvedWorkstream(rail.nodes, rail.selected());

    if (workstream === null || opening() || readOnly()) return;

    setOpening(true);

    try {
      const opened = await app.rpc("terminal.open", { workstream });

      setWanted(opened.terminal_id);
      setFailure(null);
      await rail.refresh({ terminals: true });
    } catch (thrown) {
      if (!(thrown instanceof Error)) throw thrown;

      setFailure(thrown.message);
    } finally {
      setOpening(false);
    }
  };

  // The bubble the user opened takes the keys, whether its Terminal is listed before or after `terminal.open` answers.
  createEffect(() => {
    const id = wanted();

    if (id === null || !shown().some((terminal) => terminal.id === id)) return;

    queueMicrotask(() => {
      if (bubbleElement(id) === null) return;

      focusItem(id);
      setWanted(null);
    });
  });

  const onKey = (press: KeyboardEvent): void => {
    // Help is modal: while it is open no chord acts (U54).
    if (!press.metaKey || press.ctrlKey || press.altKey || document.querySelector(".help") !== null) return;

    const key = press.key.toLowerCase();
    const backspace = press.shiftKey && (press.key === "Backspace" || press.code === "Backspace");
    const period = !press.shiftKey && (press.key === "." || press.code === "Period");
    const opens = !press.shiftKey && key === "t";
    const cycles = key === "b";

    if (!opens && !cycles && !period && !backspace) return;

    // Window capture runs before any Terminal sees the key: a chord is never a key of the program inside.
    press.preventDefault();
    press.stopPropagation();

    if (press.repeat) return;

    if (opens) void open();
    else if (cycles) cycle(press.shiftKey ? -1 : 1);
    else if (period) {
      const id = focusedId();

      if (id !== null) toggleMinimised(id);
    } else closeFocused();
  };

  const onFocusIn = (event: FocusEvent): void => {
    if (!(event.target instanceof Element) || event.target.closest("[data-bubble]")) return;

    before = event.target;
  };

  window.addEventListener("keydown", onKey, true);
  document.addEventListener("focusin", onFocusIn);
  onCleanup(() => {
    window.removeEventListener("keydown", onKey, true);
    document.removeEventListener("focusin", onFocusIn);
  });

  const Bubble = (bubble: { terminal: TerminalInfo; index: number }) => {
    const id = bubble.terminal.id;
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
    });

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

    const onHeaderKey = (press: KeyboardEvent) => {
      const arrow = ARROWS.get(press.key);

      if (!arrow || press.metaKey || press.ctrlKey || press.altKey || press.target !== press.currentTarget) return;

      press.preventDefault();

      const from = place();

      setPlace(id, clamped(press.shiftKey ? { ...from, w: from.w + arrow[0] * STEP, h: from.h + arrow[1] * STEP } : { ...from, x: from.x + arrow[0] * STEP, y: from.y + arrow[1] * STEP }, extent()));
    };

    return (
      <section
        class="bubble"
        data-bubble={id}
        role="group"
        aria-label={nameOf(bubble.terminal)}
        hidden={place().min}
        style={{ left: `${place().x}px`, top: `${place().y}px`, width: `${place().w}px`, height: `${place().h}px`, "--bubble-ground": `${(100 - transparency()) / 100}` }}
      >
        <header class="bubble-header" tabindex="0" onPointerDown={(event) => {
            // SAFETY: a pointer event on the header always targets an Element.
            if (!(event.target as Element).closest("button, input")) drag(event, (from, dx, dy) => ({ ...from, x: from.x + dx, y: from.y + dy }));
          }} onKeyDown={onHeaderKey}>
          <span class="bubble-name">{nameOf(bubble.terminal)}</span>
          <span class="bubble-state">{stateText(bubble.terminal)}</span>
          <input
            type="range"
            aria-label="transparency"
            min="0"
            max={MAX_TRANSPARENCY}
            step={TRANSPARENCY_STEP}
            value={transparency()}
            aria-valuetext={`${transparency()}%`}
            onInput={(event) => setLevel(Number(event.currentTarget.value))}
          />
          <button type="button" class="word" aria-label="minimise" onClick={() => toggleMinimised(id)}>
            <Icon name="down" />
          </button>
          <button type="button" class="word" aria-label="close" onClick={() => void close(id)}>
            <Icon name="x" />
          </button>
        </header>
        <div class="bubble-body" ref={mount} />
        <span class="bubble-corner" aria-hidden="true" onPointerDown={(event) => drag(event, (from, dx, dy) => ({ ...from, w: Math.max(MIN_WIDTH, from.w + dx), h: Math.max(MIN_HEIGHT, from.h + dy) }))} />
      </section>
    );
  };

  const chips = () => shown().filter((terminal) => places()[terminal.id]?.min);

  return (
    <div class="bubbles" ref={setLayer}>
      <For each={shown()}>{(terminal, index) => <Bubble terminal={terminal} index={index()} />}</For>
      <Show when={chips().length > 0}>
        <div class="bubble-dock">
          <For each={chips()}>
            {(terminal) => (
              <button type="button" class="word bubble-chip" data-bubble={terminal.id} onClick={() => toggleMinimised(terminal.id)}>
                {nameOf(terminal)} {running(terminal) ? "●" : "○"}
              </button>
            )}
          </For>
        </div>
      </Show>
      <Show when={failure()}>{(message) => <div class="bubble-failure"><ErrorLine message={message()} /></div>}</Show>
    </div>
  );
};
