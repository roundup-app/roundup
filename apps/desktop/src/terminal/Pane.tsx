import { appSettings } from "../settings/preferences";
import { MeasurementDashboard } from "./MeasurementDashboard";
import { TimelineView } from "../timeline/TimelineView";
import { Portal } from "solid-js/web";
import { copy } from "../copy";
import { shelfSliding } from "../shelf/sliding";
import { drawerSliding } from "../drawer/sliding";
import { resizeDragging } from "../resize/dragging";
import { For, createEffect, createMemo, createSignal, on, onCleanup, Show, untrack } from "solid-js";
import { DecisionCard } from "../decisions/DecisionCard";
import { FoldedLine } from "../decisions/FoldedLine";
import { OrderDrawer } from "../orders/OrderDrawer";
import { OrderLine } from "../orders/OrderLine";
import { ReservedLine } from "../ink/ReservedLine";
import { NoteQueue } from "./NoteQueue";
import { Icon } from "../ink/Icon";
import { doorStateOf, doorStateText } from "../rail/doorState";
import { useConnectedProject } from "../state/connectedProject";
import { registerKeys } from "../keys/registry";
import { CHORDS, TAKE_CONTROL_KEYS } from "../keys/chords";
import { KeyHint } from "../keys/KeyHint";
import { Menu } from "../ui/Menu";
import type { ToastQueue } from "../toasts/queue";
import { createSendSelection } from "./sendSelection";
import { SendToAgent } from "./SendToAgent";
import { createXtermEmulators } from "./emulator";
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
export const Pane = (props: { notice?: string | null; createEmulator?: EmulatorFactory | undefined; screensRef?: (screens: Screens) => void; toasts?: ToastQueue }) => {
  const connected = useConnectedProject();
  const { rail } = connected;
  const storage = fontSizeStorage(connected.project.path);
  let fontSize: number | undefined;
  let zoomed = storage.read() !== null;
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
    fontSize ??= storage.read() ?? appSettings().fontSize;
    const emulator = createEmulator(id);

    emulator.setFontSize(fontSize);

    return emulator;
  }, (id) => inWatch() && id === terminalId(), () => setRefused(true));

  createEffect(on(() => appSettings().fontSize, size => {
    if (!zoomed) { fontSize = size; screens.setFontSize(size); refitNextFrame(); }
  }, { defer: true }));

  createEffect(on(() => appSettings().fontFamily, () => refitNextFrame(), { defer: true }));

  props.screensRef?.(screens);

  const [view, setView] = createSignal<"dashboard" | "timeline" | null>(null);
  const dashboard = () => view() !== null;
  let dashboardAction: HTMLButtonElement | undefined;
  let timelineAction: HTMLButtonElement | undefined;

  const backFromView = () => {
    const action = view() === "timeline" ? timelineAction : dashboardAction;

    setView(null);
    queueMicrotask(() => action?.focus());
  };

  createEffect(on(rail.selected, () => setView(null), { defer: true }));
  const selected = createMemo(() => rail.nodes.find((node) => node.id === rail.selected()) ?? null);

  /** Why the selected Workstream's Door is not running, so a stopped, failed or still-starting Door each read differently. */
  const doorState = createMemo(() => {
    const workstream = selected();

    return workstream?.kind === "workstream" ? doorStateOf(workstream, rail.exitOf(workstream), rail.doorPending(workstream.id), rail.doorFailure(workstream.id) !== null) : null;
  });

  const closedAgent = createMemo(() => {
    const node = selected();

    return node?.kind === "agent" && rail.exitOf(node) !== null
      && (node.terminal_id !== null || node.status?.kind === "done" || node.status?.kind === "error");
  });

  const terminalId = createMemo(() => selected()?.terminal_id ?? null);
  /** U515, U516: the selection of this Terminal, sent to a running Agent. */
  const [contextOpen, setContextOpen] = createSignal(false);
  const sending = createSendSelection(connected, screens, terminalId, props.toasts);
  /** U38: a failure that fills this region shows in its place, never beside its empty line. */
  const notice = createMemo(() => props.notice ?? storageFailure() ?? takeFailure() ?? rail.doorFailure(selected()?.id ?? "") ?? screens.failure(terminalId()));
  const [screen, setScreen] = createSignal<HTMLDivElement>();
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

  /** U106, U515: the Terminal screen's own chords, run by the registry before xterm.js sees them. */
  const inScreen = (press: KeyboardEvent): boolean => {
    const target = press.target;

    return target instanceof Element && screen()?.contains(target) === true
      && !(target.closest('input, textarea, [contenteditable="true"]') && !target.closest(".xterm-helper-textarea"));
  };

  const resize = (key: "grow" | "shrink" | "reset") => (): void => {
    const next = key === "reset" ? appSettings().fontSize : Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, (fontSize ?? appSettings().fontSize) + (key === "grow" ? 1 : -1)));

    if (next === fontSize && key !== "reset") return;

    zoomed = key !== "reset";
    fontSize = next;
    screens.setFontSize(next);
    setStorageFailure(zoomed ? storage.write(next) : storage.clear());
    refitNextFrame();
  };

  const onScreen = (run: (id: string) => void, needsDaemon = false) => ({
    when: (press: KeyboardEvent) => terminalId() !== null && inScreen(press) && (!needsDaemon || connected.daemonExit() === null),
    run: () => run(terminalId()!),
  });

  registerKeys({ kind: "region", element: screen }, [
    { chords: ["Meta+Shift+A"], ...onScreen(() => sending.openNote()) },
    { chords: ["Meta+[Shift]+=", "Meta+[Shift]++"], ...onScreen(resize("grow"), true) },
    { chords: ["Meta+-"], ...onScreen(resize("shrink"), true) },
    { chords: ["Meta+0"], ...onScreen(resize("reset"), true) },
    { chords: ["Meta+C"], ...onScreen((id) => void screens.copy(id, navigator.clipboard)) },
    { chords: ["Meta+V"], ...onScreen((id) => void screens.paste(id, navigator.clipboard)) },
  ]);

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

  let toggleControl: HTMLButtonElement | undefined;

  const giveBack = async (): Promise<void> => {
    const id = selected()?.id;

    if (id === undefined) return;

    setTakeFailure(null);
    const failure = await connected.takeover.end(id);

    if (selected()?.id === id) {
      setTakeFailure(failure);

      if (failure === null) toggleControl?.focus();
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

  const toggle = (): Promise<void> => (taken() ? giveBack() : takeOver());

  /** U531: `⌘⏎` takes control of the selected Agent in Watch and gives it back in a Takeover, from anywhere but a text field or a Shelf row button; a Terminal's own input counts as neither. */
  const ownsTakeControl = (target: EventTarget | null): boolean => {
    if (!(target instanceof Element)) return true;

    if (target.closest(".shelf-row") && target.closest("button")) return false;

    return !target.closest('input, textarea, [contenteditable="true"]') || (!!target.closest(".xterm-helper-textarea") && (inWatch() || taken()));
  };

  registerKeys({ kind: "app" }, [{
    action: CHORDS.find((row) => row.keys === TAKE_CONTROL_KEYS)!,
    when: (press) => ownsTakeControl(press.target),
    capture: (target) => ({
      available: () => {
        const id = terminalId();

        return ownsTakeControl(target) && (inWatch() || taken()) && id !== null && !screens.exited(id)
          && connected.daemonExit() === null && selected()?.kind === "agent";
      },
      invoke: () => void toggle(),
    }),
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

  const pointerUp = () => sending.pointer(false);

  window.addEventListener("resize", onWindowResize);
  window.addEventListener("mouseup", pointerUp);
  onCleanup(() => {
    window.removeEventListener("resize", onWindowResize);
    window.removeEventListener("mouseup", pointerUp);

    if (pendingFrame !== null) cancelAnimationFrame(pendingFrame);

    screens.dispose();
  });

  return (
    <div class="pane" data-takeover={taken() ? "" : undefined} onFocusOut={leftThePane}>
      <Show when={selected()?.kind === "workstream"}>
        <div class="measurement-action" classList={{ "pane-origin-hidden": dashboard() }}><button ref={dashboardAction} data-button="quiet" type="button" onClick={() => setView("dashboard")}>{copy.costAndTime}</button><button ref={timelineAction} data-button="quiet" type="button" onClick={() => setView("timeline")}>{copy.timeline}</button></div>
      </Show>
      <Show when={view() === "dashboard" && selected()?.kind === "workstream" ? selected()!.id : null} keyed>{(home) => <MeasurementDashboard home={home} name={selected()?.name ?? ""} back={backFromView} />}</Show>
      <Show when={view() === "timeline" && selected()?.kind === "workstream" ? selected()!.id : null} keyed>{(home) => <TimelineView home={home} name={selected()?.name ?? ""} back={backFromView} />}</Show>
      <div class="pane-origin" classList={{ "pane-origin-hidden": dashboard() }}>

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
      <Show when={!decision() ? connected.decisions.folded(selected()?.id ?? null) : undefined}>{(line) => <FoldedLine line={line()} />}</Show>
      <Show when={selected()?.kind !== "workstream" && !closedAgent() ? selected() : null}>{(node) => <OrderLine node={node()} />}</Show>
      <div
        class="pane-body"
        classList={{ "drop-over": dropOver() }}
        ref={(element) => {
          body = element;
          watch(element);
        }}
      >
        <Show when={taken() || (inWatch() && terminalId() !== null && !screens.exited(terminalId()!))}>
          <div class="pane-control" data-state={taken() ? "controlled" : "managed"}>
            <div class="pane-control-state" data-label={taken() ? copy.youControl : copy.managed}>
              <ReservedLine status={taken() ? copy.youControl : refused() ? copy.managedTypingNotSent : copy.managed} />
            </div>
            <Show when={selected()?.kind === "agent"}>
              <button data-button="quiet" type="button" class="word" aria-label={taken() ? copy.endTheTakeover : copy.takeOver} aria-keyshortcuts="Meta+Enter" aria-disabled={connected.daemonExit() !== null ? true : undefined} ref={toggleControl} onClick={() => { if (connected.daemonExit() === null) void toggle(); }}>{taken() ? copy.endTheTakeover : copy.takeOver}<span class="light" aria-hidden="true">{" "}{TAKE_CONTROL_KEYS}</span></button>
            </Show>
          </div>
        </Show>
        <Menu.Root onOpenChange={(change) => setContextOpen(change.open)} onSelect={(chosen) => {
          const id = terminalId();

          if (id === null) return;

          if (chosen.value === "copy") void screens.copy(id, navigator.clipboard);
          else if (chosen.value === "paste") void screens.paste(id, navigator.clipboard);
          else sending.openNote();
        }}>
          <Menu.ContextTrigger asChild={(trigger) => <div {...trigger({ class: "pane-screen", ref: setScreen, onMouseDown: () => sending.pointer(true) })} />} />
          <Show when={contextOpen()}><Portal>
            <Menu.Positioner>
              <Menu.Content aria-label={copy.terminalMenu}>
                <Show when={sending.selected()}><Menu.Item value="copy">{copy.copy}</Menu.Item></Show>
                <Menu.Item value="paste">{copy.paste}</Menu.Item>
                <Show when={sending.selected()}><Menu.Item value="send">{copy.sendToAgent}</Menu.Item></Show>
              </Menu.Content>
            </Menu.Positioner>
          </Portal></Show>
        </Menu.Root>
        <SendToAgent send={sending} focusTerminal={focusTerminal} />
        <Show when={selected() === null && notice() === null}>
          <Show when={rail.nodes.length === 0} fallback={<p class="pane-empty">{copy.selectAnAgentOrATerminal}</p>}>
            <div class="pane-empty pane-door">
              <p class="light">{rail.workstreamCreating() ? copy.creatingWorkstream : copy.noWorkstreamYet}</p>
              <button data-button="primary" class="word pane-action" aria-disabled={rail.workstreamCreating() || connected.daemonExit() !== null ? true : undefined} onClick={() => { if (!rail.workstreamCreating() && connected.daemonExit() === null) void rail.createWorkstream(); }}>
                <Icon name="plus" />{copy.newWorkstreamWord}</button>
              <ul class="pane-empty-keys">
                <For each={CHORDS.filter((row) => row.what === copy.newAgent || row.what === copy.newTerminal || row.what === copy.askBarShortcut)}>{(row) => (
                  <li><KeyHint chipAfter keys={row.keys}>{row.what}</KeyHint></li>
                )}</For>
              </ul>
            </div>
          </Show>
        </Show>
        <Show when={selected()?.kind === "agent" && !closedAgent() && terminalId() === null && notice() === null}>
          <p class="pane-empty light">{copy.noOutputKeptFromAnEarlierRun}</p>
        </Show>
        <Show when={closedAgent()}>
          <OrderDrawer id={selected()!.id} inline />
        </Show>
        <Show when={doorState()}>
          {(state) => (
            <div class="pane-empty pane-door">
              <p class="light">{doorStateText(state())}</p>
              <button data-button="primary" class="word pane-action" aria-disabled={rail.doorPending(selected()!.id) || connected.daemonExit() !== null ? true : undefined} onClick={() => { if (!rail.doorPending(selected()!.id) && connected.daemonExit() === null) void rail.startDoor(selected()!.id); }}>
                <Icon name="play" />
                {rail.doorFailure(selected()!.id) ? copy.retry : copy.start}
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
      <Show when={selected()?.kind === "agent" && terminalId() !== null && !closedAgent() ? selected() : null} keyed>{(node) => <NoteQueue node={node} />}</Show>
      </div>
      <div class="pane-failure">
        <ReservedLine class={connected.decisions.listFailure() ? "decision-list-failure" : undefined} message={notice() ?? rail.workstreamFailure() ?? connected.decisions.listFailure()}>
          <Show when={connected.decisions.listFailure()}><button data-button="quiet" type="button" class="word" onClick={() => connected.decisions.retryList()}>{copy.retry}</button></Show>
        </ReservedLine>
      </div>
    </div>
  );
};
