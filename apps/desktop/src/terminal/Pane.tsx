import { EmptyState } from "../ink/EmptyState";
import { makeEventListener } from "@solid-primitives/event-listener";
import { makeResizeObserver } from "@solid-primitives/resize-observer";
import { appSettings } from "../settings/preferences";
import { copy } from "./copy";
import { shelfSliding } from "../shelf/sliding";
import { drawerSliding } from "../drawer/sliding";
import { resizeDragging } from "../resize/dragging";
import { createEffect, createMemo, createSignal, on, onCleanup, Show, untrack } from "solid-js";
import { ReservedLine } from "../ink/ReservedLine";
import { Icon } from "../ink/Icon";
import { doorStateOf, doorStateText } from "../rail/doorState";
import { useConnectedProject } from "../state/connectedProject";
import { registerKeys } from "../keys/registry";
import { CHORDS } from "../keys/chords";
import { lazyXtermEmulators } from "./lazyEmulator";
import type { EmulatorFactory } from "./emulator";
import { MIN_FONT_SIZE, MAX_FONT_SIZE, fontSizeStorage } from "./fontSize";
import { createScreens } from "./screens";
import type { Screens } from "./screens";
import "./styles.css";


/**
 * The selected row's Terminal. Every error line of the centre lives in the pane's one fixed-height slot, so the
 * screen never moves after it was fitted: `notice` (the Daemon or Rail failure) wins over the pane's own failure.
 * `createEmulator` is the edge tests replace; the App passes none, except the keystroke run (`scenarios/perf.md` K3).
 */
export const Pane = (props: { notice?: string | null; retryNotice?: (() => void) | undefined; createEmulator?: EmulatorFactory | undefined; screensRef?: (screens: Screens) => void; observeTerminal?: ((id: string | null) => void) | undefined }) => {
  const connected = useConnectedProject();
  const { rail } = connected;
  const storage = fontSizeStorage(connected.project.path);
  let fontSize: number | undefined;
  let zoomed = storage.read() !== null;
  const [storageFailure, setStorageFailure] = createSignal<string | null>(null);
  const createEmulator = props.createEmulator ?? lazyXtermEmulators();

  const screens = createScreens(connected, (id, copy) => {
    fontSize ??= storage.read() ?? appSettings().fontSize;
    const emulator = createEmulator(id, copy);

    emulator.setFontSize(fontSize);

    return emulator;
  });

  createEffect(on(() => appSettings().fontSize, size => {
    if (!zoomed) { fontSize = size; screens.setFontSize(size); refitNextFrame(); }
  }, { defer: true }));

  createEffect(on(() => appSettings().fontFamily, () => refitNextFrame(), { defer: true }));

  props.screensRef?.(screens);

  const selected = createMemo(() => rail.nodes.find((node) => node.id === rail.selected()) ?? null);

  /** Why the selected Workstream's Door is not running, so a stopped, failed or still-starting Door each read differently. */
  const doorState = createMemo(() => {
    const workstream = selected();

    return workstream?.kind === "workstream" ? doorStateOf(workstream, rail.exitOf(workstream), rail.doorPending(workstream.id), rail.doorFailure(workstream.id) !== null) : null;
  });

  const terminalId = createMemo(() => selected()?.terminal_id ?? null);

  createEffect(() => props.observeTerminal?.(terminalId()));
  onCleanup(() => props.observeTerminal?.(null));

  /** U38: a failure that fills this region shows in its place, never beside its empty line. */
  const notice = createMemo(() => {
    if (props.notice != null) return { kind: "notice" as const, message: props.notice };

    if (rail.commandFailure.surface() === "pane") return { kind: "command" as const, message: rail.commandFailure.message() };

    const stored = storageFailure();

    if (stored !== null) return { kind: "storage" as const, message: stored };

    const scheme = connected.terminalScheme.failure();

    if (scheme !== null) return { kind: "scheme" as const, message: scheme };

    const terminal = screens.viewedInBubble(terminalId() ?? "") ? null : screens.failure(terminalId());

    return terminal === null ? null : { kind: "terminal" as const, message: terminal };
  });

  const [screen, setScreen] = createSignal<HTMLDivElement>();
  const [preparing, setPreparing] = createSignal(false);
  let preparation: AbortController | undefined;
  rail.prepareTerminal = async () => {
    preparation?.abort();
    const controller = new AbortController();
    preparation = controller;
    setPreparing(true);
    const host = screen();

    try {
      if (!host) throw new Error(copy.terminalDestinationUnavailable);
      const prepared = await screens.prepare(host, () => !resizeDragging() && !drawerSliding() && !shelfSliding(), controller.signal);

      return { ...prepared, dispose: () => {
        prepared.dispose();

        if (preparation === controller) {
          preparation = undefined;
          setPreparing(false);
        }
      } };
    } catch (error) {
      if (preparation === controller) {
        preparation = undefined;
        setPreparing(false);
      }

      controller.signal.throwIfAborted();

      // A host that cannot be prepared must not block the launch: the Terminal fits to it once shown.
      console.warn(error);

      return undefined;
    }
  };

  createEffect(on(rail.selected, () => preparation?.abort(), { defer: true }));
  onCleanup(() => { preparation?.abort(); rail.prepareTerminal = undefined; });
  let pendingFrame: number | null = null;

  const refit = () => {
    pendingFrame = null;

    const id = terminalId();

    if (resizeDragging() || drawerSliding() || shelfSliding()) return;

    if (id !== null && connected.daemonExit() === null) screens.resize(id, screens.emulatorFor(id).fit(), true);
  };

  const refitNextFrame = () => {
    pendingFrame ??= requestAnimationFrame(refit);
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

    if (!host || preparing()) return;

    if (id === null) {
      host.replaceChildren();

      return;
    }

    untrack(() => {
      const show = (focus: boolean) => screens.resize(id, screens.show(id, host, focus));

      if (rail.restored() || !rail.terminalFocus()(() => show(true))) show(false);
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

  /** U106: the Terminal screen's own chords, run by the registry before xterm.js sees them. */
  const inScreen = (target: Element | null): boolean => {
    return target instanceof Element && screen()?.contains(target) === true
      && !(target.closest('input, textarea, [contenteditable="true"]') && !target.closest(".xterm-helper-textarea"));
  };

  const resize = (key: "grow" | "shrink" | "reset") => (): void => {
    const next = key === "reset" ? appSettings().fontSize : Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, (fontSize ?? appSettings().fontSize) + (key === "grow" ? 1 : -1)));

    if (next === fontSize && key !== "reset") return;

    zoomed = key !== "reset";
    fontSize = next;
    screens.setFontSize(next);
    void (zoomed ? storage.write(next) : storage.clear()).then(setStorageFailure);
    refitNextFrame();
  };

  registerKeys({ kind: "region", element: screen }, [
    { chord: "⌘=", chords: ["Meta+[Shift]+=", "Meta+[Shift]++"], resize: "grow" as const },
    { chord: "⌘-", chords: ["Meta+-"], resize: "shrink" as const },
    { chord: "⌘0", chords: ["Meta+0"], resize: "reset" as const },
  ].map(({ chord, chords, resize: size }) => ({
    action: CHORDS.find(action => action.keys === chord)!,
    chords,
    repeat: true,
    when: event => terminalId() !== null && inScreen(event.target instanceof Element ? event.target : null) && connected.daemonExit() === null,
    capture: focus => {
      const id = terminalId();

      return {
        available: () => id !== null && terminalId() === id && inScreen(focus) && focus?.isConnected === true && connected.daemonExit() === null,
        invoke: resize(size),
      };
    },
  })));

  /** P3557c: only a Terminal failure is the user's to dismiss; a retention, Rail or Daemon line keeps its own recovery. */
  const dismissFailure = (): (() => void) | null => {
    if (notice()?.kind !== "terminal") return null;

    const id = terminalId();

    return rail.doorFailure(selected()?.id ?? "") === null && id !== null && !screens.viewedInBubble(id) && screens.failure(id) !== null ? () => screens.dismiss(id) : null;
  };

  // U162: the window's native File drop, reported by the App seam. The ring shows only while a drop would be taken.
  const [dropOver, setDropOver] = createSignal(false);
  let body: HTMLElement | undefined;

  const takesDrop = (): string | null => {
    const id = terminalId();

    return id !== null && connected.daemonExit() === null && !screens.exited(id) ? id : null;
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

  // A Card appearing, growing or going changes the Terminal's room without a window resize.
  const resizeObserver = typeof ResizeObserver === "undefined" ? undefined : makeResizeObserver(refitNextFrame);

  makeEventListener(window, "resize", refitNextFrame);
  onCleanup(() => {
    if (pendingFrame !== null) cancelAnimationFrame(pendingFrame);

    screens.dispose();
  });

  return (
    <div class="pane">
      <div class="pane-origin">

      <div
        class="pane-body"
        classList={{ "drop-over": dropOver() }}
        ref={(element) => {
          body = element;
        }}
      >
        <div class="pane-screen" ref={element => { setScreen(element); resizeObserver?.observe(element); }} />
        <Show when={!preparing() && selected()?.kind === "agent" && terminalId() === null && (notice() === null || notice()?.kind === "command")}>
          <EmptyState art="sitting-reading" {...{ title: copy.noOutputKeptFromAnEarlierRun }} line={copy.emptyOutputLine} />
        </Show>
        <Show when={doorState()}>
          {(state) => (
            <div class="pane-door"><EmptyState art="meditating" {...{ title: doorStateText(state(), selected()!.name) }} line={copy.emptyOutputLine} action={<button data-button="primary" class="word pane-action" aria-disabled={rail.doorPending(selected()!.id) || connected.daemonExit() !== null ? true : undefined} onClick={() => { if (!rail.doorPending(selected()!.id) && connected.daemonExit() === null) void rail.startDoor(selected()!.id); }}>
                <Icon name="play" />
                {rail.doorFailure(selected()!.id) ? copy.retry : copy.start}
              </button>} />
            </div>
          )}
        </Show>
        <Show when={latest()}>
          {(id) => (
            <button data-button="quiet" type="button" class="word pane-latest" onClick={() => screens.returnToBottom(id())}>{copy.latest}</button>
          )}
        </Show>
      </div>
      </div>
      <Show when={notice()}><div class="pane-failure">
        <ReservedLine message={notice()?.message}>
          <Show when={notice()?.kind === "scheme"}><button data-button="quiet" type="button" onClick={() => void connected.terminalScheme.retry()}>{copy.retry}</button></Show>
          <Show when={notice()?.kind === "notice" && props.retryNotice}><button data-button="quiet" type="button" onClick={() => props.retryNotice?.()}>{copy.retry}</button></Show>
          <Show when={dismissFailure()}>{(dismiss) => <button data-button="quiet" type="button" class="word" onClick={() => dismiss()()}>{copy.dismissFailure}</button>}</Show>
        </ReservedLine>
      </div></Show>
    </div>
  );
};
