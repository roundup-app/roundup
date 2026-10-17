import { copy } from "../copy";
import { shelfSliding } from "../shelf/sliding";
import { drawerSliding } from "../drawer/sliding";
import { resizeDragging } from "../resize/dragging";
import { createEffect, createMemo, createSignal, on, onCleanup, Show, untrack } from "solid-js";
import { DecisionCard } from "../decisions/DecisionCard";
import { OrderLine } from "../orders/OrderLine";
import { ErrorLine } from "../ink/ErrorLine";
import { Icon } from "../ink/Icon";
import { doorStateOf, doorStateText } from "../rail/doorState";
import { useConnectedProject } from "../state/connectedProject";
import { registerKeys } from "../keys/registry";
import { TAKE_CONTROL, WRITING_KEYS } from "../keys/chords";
import { createXtermEmulators } from "./emulator";
import type { EmulatorFactory } from "./emulator";
import { DEFAULT_FONT_SIZE, MIN_FONT_SIZE, MAX_FONT_SIZE, fontSizeStorage } from "./fontSize";
import { createScreens } from "./screens";
import type { Screens } from "./screens";
import "./styles.css";

/**
 * The selected row's Terminal. Every error line of the centre lives in the pane's one fixed-height slot, so the
 * screen never moves after it was fitted: `notice` (the Daemon or Rail failure) wins over the pane's own failure.
 * `createEmulator` is the edge tests replace; the App passes none, except the keystroke run (`scenarios/perf.md` K3).
 */
export const Pane = (props: { notice?: string | null; createEmulator?: EmulatorFactory | undefined; screensRef?: (screens: Screens) => void }) => {
  const connected = useConnectedProject();
  const { rail } = connected;
  const storage = fontSizeStorage(connected.project.path);
  let fontSize: number | undefined;
  const [takeFailure, setTakeFailure] = createSignal<string | null>(null);
  const [storageFailure, setStorageFailure] = createSignal<string | null>(null);
  const createEmulator = props.createEmulator ?? createXtermEmulators();

  /** U375: an Agent below a Door is read-only until the user takes it over; the Door itself is always typed into (U467),
   * and a child that needs you takes keys, so the user answers its question or permission in its own Terminal (U468). */
  const inWatch = (): boolean => {
    const id = rail.selected();

    return id !== null && !isDoor(id) && belowDoor(id) && !needsYou(id) && connected.takeover.taken() !== id;
  };

  const needsYou = (id: string): boolean => rail.nodes.find((node) => node.id === id)?.status?.kind === "needs-you";

  const belowDoor = (from: string): boolean => {
    for (let id: string | null = from; id !== null; ) {
      const found = rail.nodes.find((node) => node.id === id);

      if (found === undefined) return false;

      if (found.kind === "workstream") return true;

      id = found.parent;
    }

    return false;
  };

  const isDoor = (id: string): boolean => rail.nodes.find((node) => node.id === id)?.kind === "workstream";

  const screens = createScreens(connected, (id) => {
    fontSize ??= storage.read() ?? DEFAULT_FONT_SIZE;
    const emulator = createEmulator(id);

    emulator.setFontSize(fontSize);

    return emulator;
  }, (id) => inWatch() && id === terminalId());

  props.screensRef?.(screens);

  const selected = createMemo(() => rail.nodes.find((node) => node.id === rail.selected()) ?? null);

  /** Why the selected Workstream's Door is not running, so a stopped, failed or still-starting Door each read differently. */
  const doorState = createMemo(() => {
    const workstream = selected();

    return workstream?.kind === "workstream" ? doorStateOf(workstream, rail.exitOf(workstream), rail.doorPending(workstream.id), rail.doorFailure(workstream.id) !== null) : null;
  });

  const terminalId = createMemo(() => selected()?.terminal_id ?? null);
  /** U38: a failure that fills this region shows in its place, never beside its empty line. */
  const notice = createMemo(() => props.notice ?? storageFailure() ?? takeFailure() ?? rail.doorFailure(selected()?.id ?? "") ?? screens.failure(terminalId()));
  const [screen, setScreen] = createSignal<HTMLDivElement>();
  let pane: HTMLDivElement | undefined;
  let pendingFrame: number | null = null;

  let windowResized = false;

  const refit = () => {
    pendingFrame = null;

    const id = terminalId();

    if (resizeDragging() || drawerSliding() || shelfSliding()) return;

    if (id !== null && connected.daemonExit() === null) screens.resize(id, screens.emulatorFor(id).fit(), !windowResized);

    windowResized = false;
  };

  const refitNextFrame = () => {
    pendingFrame ??= requestAnimationFrame(refit);
  };

  const onWindowResize = () => {
    windowResized = true;
    refitNextFrame();
  };

  // U389, U371: a Resize edge drag changes the pane's width every frame; the Terminal is fitted once when it ends.
  createEffect(on(resizeDragging, (now) => { if (!now) refitNextFrame(); }, { defer: true }));

  // U430: a Drawer's slide narrows or widens the pane over its duration; the Terminal is fitted once when it ends.
  createEffect(on(drawerSliding, (now) => { if (!now) refitNextFrame(); }, { defer: true }));

  createEffect(on(shelfSliding, (now) => { if (!now) refitNextFrame(); }, { defer: true }));

  // X14: the Terminal the selection leaves stops receiving output; only its subscription is released.
  createEffect(on(terminalId, (_id, previous) => { if (previous != null) screens.hide(previous); }, { defer: true }));

  createEffect(() => {
    const host = screen();
    const id = terminalId();

    if (!host) return;

    if (id === null) {
      host.replaceChildren();

      return;
    }

    untrack(() => {
      const size = screens.show(id, host, !rail.restored() && !inWatch());

      screens.resize(id, size);
    });
  });

  // Solid settles every memo before it runs any effect, so an effect that creates the emulator would still be
  // unrun the first time this reads `isAtBottom` for a newly selected Terminal; ensure it inside the memo instead.
  // The id this control should return to, or null while there is nothing to show: the only guard for both "no
  // Terminal selected" and "already at the bottom", so no two guards can disagree about one decision.
  const latest = createMemo(() => {
    const id = terminalId();

    if (id === null) return null;

    screens.emulatorFor(id);

    return screens.isAtBottom(id) ? null : id;
  });

  /** U532: a key landed on the watched pane, so the band says why nothing was sent. */
  const [refused, setRefused] = createSignal(false);

  const typed = (press: KeyboardEvent): boolean =>
    !press.metaKey && !press.ctrlKey && !press.altKey
    && (press.key.length === 1 || WRITING_KEYS.includes(press.key));

  const onKeyDown = (press: KeyboardEvent): void => {
    if (inWatch() && typed(press) && press.target instanceof Element && press.target.closest(".pane-screen")) setRefused(true);

    if (!press.metaKey || press.ctrlKey || press.altKey) return;

    const target = press.target;

    if (!(target instanceof Element) || !target.closest(".pane-screen")) return;

    if (target.closest('input, textarea, [contenteditable="true"]') && !target.closest(".xterm-helper-textarea")) return;

    const id = terminalId();

    if (id === null) return;

    const key = press.key.toLowerCase();

    const grows = key === "=" || key === "+";

    if (press.shiftKey && !grows) return;

    if (grows || key === "-" || key === "0") {
      if (connected.daemonExit() !== null) return;

      press.preventDefault();
      press.stopPropagation();

      const next = key === "0" ? DEFAULT_FONT_SIZE : Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, (fontSize ?? DEFAULT_FONT_SIZE) + (grows ? 1 : -1)));

      if (next === fontSize) return;

      fontSize = next;
      screens.setFontSize(next);
      setStorageFailure(storage.write(next));
      refitNextFrame();

      return;
    }

    if (key !== "c" && key !== "v") return;

    press.preventDefault();
    press.stopPropagation();

    const clipboard = navigator.clipboard;

    if (key === "c") void screens.copy(id, clipboard);
    else void screens.paste(id, clipboard);
  };

  onCleanup(() => pane?.removeEventListener("keydown", onKeyDown, true));

  const leftThePane = (leave: FocusEvent): void => {
    if (!(leave.relatedTarget instanceof Element) || !leave.relatedTarget.closest(".pane-screen")) setRefused(false);
  };

  const taken = (): boolean => {
    const id = selected()?.id ?? null;

    return id !== null && connected.takeover.taken() === id;
  };

  createEffect(on(() => rail.selected(), () => setTakeFailure(null), { defer: true }));
  createEffect(() => { if (!inWatch()) setRefused(false); });

  const takeOver = async (): Promise<void> => {
    const id = selected()?.id;

    if (id === undefined) return;

    setTakeFailure(null);

    const failure = await connected.takeover.begin(id);

    setTakeFailure(failure);

    if (failure === null) focusTerminal();
  };

  let takeControl: HTMLButtonElement | undefined;

  const giveBack = async (): Promise<void> => {
    const id = selected()?.id;

    if (id === undefined) return;

    setTakeFailure(null);
    const failure = await connected.takeover.end(id);

    if (selected()?.id === id) {
      setTakeFailure(failure);

      if (failure === null) takeControl?.focus();
    }
  };

  const decision = createMemo(() => connected.decisions.of(selected()?.id ?? null));

  let card: HTMLElement | undefined;
  let focusInCard = false;

  // The Card is the one thing the user types into besides the Terminal, so its removal hands the keyboard back, but only if it held it.
  createEffect(on(() => decision()?.id, (id, previous) => {
    if (previous === undefined || id === previous) return;

    const held = focusInCard;

    focusInCard = false;

    const current = terminalId();

    if (held && current !== null) screens.emulatorFor(current).focus();
  }));

  const focusTerminal = () => {
    const current = terminalId();

    if (current !== null) screens.emulatorFor(current).focus();
  };

  /** U531: `⌘⏎` takes control of the selected Agent in Watch, from anywhere but a text field, a Shelf row button or a Terminal that is taken. */
  registerKeys({ kind: "app" }, [{
    chords: TAKE_CONTROL,
    when: (press) => {
      const target = press.target;

      if (!(target instanceof Element)) return true;

      if (target.closest(".shelf-row") && target.closest("button")) return false;

      return !target.closest('input, textarea, [contenteditable="true"]') || (!!target.closest(".xterm-helper-textarea") && inWatch());
    },
    run: (press) => {
      const id = terminalId();

      if (press.repeat || !inWatch() || id === null || screens.exited(id) || connected.daemonExit() !== null || selected()?.kind !== "agent") return;

      void takeOver();
    },
  }]);

  // U162: the window's native File drop, reported by the App seam. The ring shows only while a drop would be taken.
  const [dropOver, setDropOver] = createSignal(false);
  let body: HTMLElement | undefined;

  const takesDrop = (): string | null => {
    const id = terminalId();

    return id !== null && !inWatch() && connected.daemonExit() === null && !screens.exited(id) ? id : null;
  };

  const inBody = (x: number, y: number): boolean => {
    const box = body?.getBoundingClientRect();

    if (body === undefined || box === undefined || x < box.left || x >= box.right || y < box.top || y >= box.bottom) return false;

    // An open Drawer sits over the pane, so the rectangle alone would take its drops.
    const hit = document.elementFromPoint?.(x, y);

    return hit === undefined || (hit !== null && body.contains(hit));
  };

  let unlistenDrop: (() => void) | undefined;
  let closed = false;

  void connected.app.onFileDrop((drop) => {
    const id = takesDrop();

    if (drop.phase === "leave" || id === null || !inBody(drop.x, drop.y)) {
      setDropOver(false);

      return;
    }

    setDropOver(drop.phase === "over");

    if (drop.phase === "drop") {
      screens.pastePaths(id, drop.paths);
      screens.emulatorFor(id).focus();
    }
  }).then((stop) => {
    if (closed) stop();
    else unlistenDrop = stop;
  });

  createEffect(on(terminalId, () => setDropOver(false)));
  createEffect(() => { if (takesDrop() === null) setDropOver(false); });
  onCleanup(() => {
    closed = true;
    unlistenDrop?.();
  });

  let watched: ResizeObserver | undefined;

  // A Card appearing, growing or going changes the Terminal's room without a window resize.
  const watch = (body: HTMLElement) => {
    if (typeof ResizeObserver === "undefined") return;

    watched = new ResizeObserver(refitNextFrame);
    watched.observe(body);
    onCleanup(() => watched?.disconnect());
  };

  window.addEventListener("resize", onWindowResize);
  onCleanup(() => {
    window.removeEventListener("resize", onWindowResize);

    if (pendingFrame !== null) cancelAnimationFrame(pendingFrame);

    screens.dispose();
  });

  return (
    <div class="pane" data-takeover={taken() ? "" : undefined} ref={(element) => {
      pane = element;
      element.addEventListener("keydown", onKeyDown, true);
      element.addEventListener("focusout", leftThePane);
    }}>
      <Show when={connected.decisions.listFailure()}>
        {(message) => (
          <div class="decision-list-failure">
            <ErrorLine message={message()} />
            <button data-button="quiet" type="button" class="word" onClick={() => connected.decisions.retryList()}>{copy.retry}</button>
          </div>
        )}
      </Show>
      <Show when={decision()}>
        {(open) => (
          <DecisionCard
              decision={open()}
              name={selected()?.name ?? ""}
              focusTerminal={focusTerminal}
              ref={(element) => { card = element; }}
              onFocusIn={() => { focusInCard = true; }}
              onFocusOut={(leave) => {
                if (leave.relatedTarget instanceof Node && !card?.contains(leave.relatedTarget)) focusInCard = false;
                else if (leave.relatedTarget === null) queueMicrotask(() => { if (card?.isConnected && !card.contains(document.activeElement)) focusInCard = false; });
              }}
            />
        )}
      </Show>
      <Show when={selected()?.kind !== "workstream" ? selected() : null}>{(node) => <OrderLine node={node()} />}</Show>
      <Show when={taken()}>
        <p class="pane-takeover" role="status"><span>{copy.takeoverTypingGoesStraightTo}{selected()?.name}</span>
          <Show when={selected()?.kind === "agent"}>
            <button data-button="quiet" type="button" class="word" aria-disabled={connected.daemonExit() !== null ? true : undefined} onClick={() => { if (connected.daemonExit() === null) void giveBack(); }}>{copy.endTheTakeover}</button>
          </Show>
        </p>
      </Show>
      <Show when={inWatch() && terminalId() !== null && !screens.exited(terminalId()!)}>
        <div class="pane-watch" role="status">
          <span>{refused() ? copy.readOnlyTakeControlWith : `${copy.watching}${selected()?.name}${copy.readOnly}`}</span>
          <button data-button="quiet" type="button" class="word" aria-label={copy.takeOver} aria-disabled={connected.daemonExit() !== null ? true : undefined} ref={takeControl} onClick={() => { if (connected.daemonExit() === null) void takeOver(); }}>{copy.takeOver}<span class="light" aria-hidden="true">{" "}{copy.takeControlKeys}</span></button>
        </div>
      </Show>
      <div
        class="pane-body"
        classList={{ "drop-over": dropOver() }}
        ref={(element) => {
          body = element;
          watch(element);
        }}
      >
        <div class="pane-screen" ref={setScreen} />
        <Show when={selected() === null && notice() === null}>
          <Show when={rail.nodes.length === 0} fallback={<p class="pane-empty">{copy.selectAnAgentOrATerminal}</p>}>
            <div class="pane-empty pane-door">
              <p class="light">{rail.workstreamCreating() ? copy.creatingWorkstream : copy.noWorkstreamYet}</p>
              <button data-button="primary" class="word pane-action" aria-disabled={rail.workstreamCreating() || connected.daemonExit() !== null ? true : undefined} onClick={() => { if (!rail.workstreamCreating() && connected.daemonExit() === null) void rail.createWorkstream(); }}>
                <Icon name="plus" />{copy.newWorkstreamWord}</button>
            </div>
          </Show>
        </Show>
        <Show when={selected()?.kind !== "workstream" && selected() !== null && terminalId() === null && notice() === null}>
          <p class="pane-empty light">{copy.noOutputKeptFromAnEarlierRun}</p>
        </Show>
        <Show when={doorState()}>
          {(state) => (
            <div class="pane-empty pane-door">
              <p class="light">{doorStateText(state())}</p>
              <button data-button="primary" class="word pane-action" aria-disabled={rail.doorPending(selected()!.id) || connected.daemonExit() !== null ? true : undefined} onClick={() => { if (!rail.doorPending(selected()!.id) && connected.daemonExit() === null) void rail.startDoor(selected()!.id); }}>
                <Icon name="right" />
                {rail.doorFailure(selected()!.id) ? copy.retryDoor : copy.startDoor}
              </button>
            </div>
          )}
        </Show>
        <Show when={latest()}>
          {(id) => (
            <button data-button="quiet" type="button" class="word pane-latest" onClick={() => screens.returnToBottom(id())}>{copy.latest}</button>
          )}
        </Show>
      </div>
      <div class="pane-failure">
        <Show when={notice() ?? rail.workstreamFailure()}>{(message) => <ErrorLine message={message()} />}</Show>
      </div>
    </div>
  );
};
