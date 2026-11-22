import { provideFocusTarget } from "../keys/focus";
import { ChangesView } from "../changes/ChangesView";
import { siblingsOf } from "../state/railTopology";
import { EmptyState } from "../ink/EmptyState";
import { makeEventListener } from "@solid-primitives/event-listener";
import { makeResizeObserver } from "@solid-primitives/resize-observer";
import { appSettings, saveAppSettings } from "../settings/preferences";
import { copy } from "./copy";
import { BusyButton } from "../ui/BusyButton";
import { layoutMoving } from "../resize/motion";
import { createRestartable } from "../ink/restartable";
import { createEffect, createMemo, createSignal, onCleanup, onSettled, Show, For, untrack } from "solid-js";
import type { JSX } from "@solidjs/web";
import { dismissable } from "../ink/recovery";
import { createMessageToast } from "../ink/messageToast";
import type { Recovery } from "../ink/recovery";
import { Icon } from "../ink/Icon";
import { doorStateOf, doorStateText } from "../rail/doorState";
import { useConnectedProject } from "../state/connectedProject";
import type { ConnectedProject } from "../state/connectedProject";
import { registerKeys } from "../keys/registry";
import { CHORDS } from "../keys/chords";
import { captureActions, modalOpen } from "../keys/registry";
import { Find } from "./Find";
import { PlayMarks } from "./PlayMarks";
import { lazyXtermEmulators } from "./lazyEmulator";
import type { EmulatorFactory } from "./emulator";
import { DEFAULT_FONT_SIZE, MIN_FONT_SIZE, MAX_FONT_SIZE } from "./fontSize";
import { createFileDrop } from "./fileDrop";
import { createScreens } from "./screens";
import type { Screens } from "./screens";
import "./styles.css";
import { doorTerminalId } from "../state/doorNode";
import { centreState } from "./centreState";


type PaneNotice = { kind: "notice" | "command" | "terminal"; message: string; notice?: boolean; recovery: Recovery };

/** The one failure the pane shows, with what the user can do about it: each kind states its own dismissal and retry. */
const paneNotice = ({ given, retry, rail, screens, terminal }: {
  given: ReturnType<typeof dismissable>;
  retry: (() => void) | undefined;
  rail: ConnectedProject["rail"];
  screens: Screens;
  terminal: string | null;
}): PaneNotice | null => {
  const message = given.message();

  if (message) return { kind: "notice", message, recovery: { dismiss: given.dismiss, recover: retry ? { run: retry } : undefined } };

  const command = rail.commandFailure.surface() === "pane" ? rail.commandFailure.message() : null;

  if (command !== null) {
    const again = rail.commandFailure.retry();

    return { kind: "command", message: command, notice: rail.commandFailure.notice(), recovery: { dismiss: rail.commandFailure.clear, recover: again ? { run: again } : undefined } };
  }

  const shown = terminal !== null && screens.viewedInBubble(terminal) ? null : screens.failure(terminal);

  if (shown === null) return null;

  const again = screens.retry(terminal);

  return { kind: "terminal", message: shown, recovery: { dismiss: () => screens.dismiss(terminal), recover: again ? { run: again } : undefined } };
};

/**
 * The selected row's Terminal. Every error line of the centre lives in the pane's one fixed-height slot, so the
 * screen never moves after it was fitted: `notice` (the Daemon or Rail failure) wins over the pane's own failure.
 * `createEmulator` is the edge tests replace; the App passes none, except the keystroke run (`scenarios/perf.md` K3).
 * `over` floats over the Terminal's fixed top inset (LH6, LH12), out of the layout flow, so it never resizes the Terminal (U4590).
 */
export const Pane = (props: { notice?: string | null; retryNotice?: (() => void) | undefined; createEmulator?: EmulatorFactory | undefined; screensRef?: (screens: Screens) => void; observeTerminal?: ((id: string | null) => void) | undefined; openObject?: ((url: string, surface: string) => void) | undefined; over?: JSX.Element; /** LH6: the links header laid over the Terminal's top edge. */ header?: JSX.Element }) => {
  const connected = useConnectedProject();
  const { rail } = connected;
  let fontSize: number | undefined;
  const createEmulator = untrack(() => props.createEmulator) ?? lazyXtermEmulators();

  const screens = createScreens(connected, (id, copy) => {
    fontSize ??= untrack(() => appSettings().fontSize);
    const emulator = createEmulator(id, copy);

    emulator.setFontSize(fontSize);

    return emulator;
  }, props.openObject);

  createEffect(createMemo(() => appSettings().fontSize), size => {
    fontSize = size;
    screens.setFontSize(size);
    refitNextFrame();
  }, { defer: true });

  createEffect(createMemo(() => appSettings().fontFamily), () => { refitNextFrame(); }, { defer: true });

  onSettled(() => { props.screensRef?.(screens); });

  const selected = createMemo(() => rail.nodes.find((node) => node.id === rail.selected()) ?? null);

  /** Why the selected Workstream's Door is not running, so a stopped, failed or still-starting Door each read differently. */
  const doorState = createMemo(() => {
    const workstream = selected();

    return workstream?.kind === "workstream" ? doorStateOf(workstream, rail.exitOf(workstream), rail.launching(workstream.id), rail.doorFailure(workstream.id) !== null, rail.doorFailure(workstream.id) !== null && !rail.doorRetryable(workstream.id)) : null;
  });

  const terminalId = createMemo(() => doorTerminalId(selected()));

  createEffect(() => [terminalId(), props.observeTerminal] as const, ([id, observe]) => { observe?.(id); });
  onCleanup(() => props.observeTerminal?.(null));

  /** U38: a failure that fills this region shows in its place, never beside its empty line. */
  const givenNotice = dismissable(() => props.notice);

  const notice = createMemo(() => paneNotice({ given: givenNotice, retry: props.retryNotice, rail, screens, terminal: terminalId() }));

  // U7314b: the pane's failure shows as a toast, so the Terminal keeps its size and place.
  createMessageToast({ get message() { return notice()?.message; }, dismiss: () => notice()?.recovery.dismiss?.(), get recover() { return notice()?.recovery.recover; }, get notice() { return notice()?.kind === "command" && notice()?.notice === true; } });

  const [screen, setScreen] = createSignal<HTMLDivElement>();
  const [preparing, setPreparing] = createSignal(false);

  /** U7889: the Agent and Terminal whose marks show, as one string, so the marks live and die with the selection, not with each refreshed row. */
  const playKey = createMemo(() => {
    const node = selected();
    const terminal = terminalId();

    return node?.kind === "agent" && terminal !== null && screen() !== undefined ? `${node.id}\n${terminal}` : null;
  });

  let preparation: AbortController | undefined;
  rail.prepareTerminal = async () => {
    preparation?.abort();
    const controller = new AbortController();
    preparation = controller;
    setPreparing(true);
    const host = screen();

    try {
      if (!host) throw new Error(copy.terminalDestinationUnavailable);
      const prepared = await screens.prepare(host, () => !layoutMoving(), controller.signal);

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

  createEffect(rail.selected, () => { preparation?.abort(); }, { defer: true });
  onCleanup(() => { preparation?.abort(); rail.prepareTerminal = undefined; });
  let pendingFrame: number | null = null;

  const refit = () => {
    pendingFrame = null;

    const id = terminalId();

    if (layoutMoving()) return;

    if (id !== null && connected.daemonExit() === null) screens.resize(id, screens.emulatorFor(id).fit(), true);
  };

  const refitNextFrame = () => {
    pendingFrame ??= requestAnimationFrame(refit);
  };

  // U389, U430, U371: an edge drag or a Drawer or Shelf slide changes the pane's width every frame; the Terminal is fitted once when it ends.
  createEffect(layoutMoving, (now) => { if (!now) refitNextFrame(); }, { defer: true });

  // X14: the Terminal the selection leaves stops receiving output; only its subscription is released.
  createEffect(terminalId, (_id, previous) => { if (previous != null) untrack(() => screens.hide(previous)); });

  createEffect(() => {
    const host = screen();
    const id = terminalId();
    const focusPermission = rail.terminalFocus();
    const doorNotRunning = doorState() !== null;

    return { host, id, focusPermission, doorNotRunning, preparing: host !== undefined && preparing() };
  }, ({ host, id, focusPermission, doorNotRunning, preparing }) => {
    if (!host || preparing) return;

    if (id === null) {
      host.replaceChildren();

      return;
    }

    untrack(() => {
      screens.resize(id, screens.show(id, host, false));

      // A modal layer keeps its focus; the Dialog's close returns focus to the pane.
      if (!rail.restored() && !doorNotRunning && !modalOpen()) {
        // A mounted Drawer may still cover the centre until its dismissal effects settle.
        const focus = () => focusPermission(() => screens.emulatorFor(id).focus());

        if (host.closest(".window")?.querySelector('.drawer[data-mounted="true"]')) queueMicrotask(focus);
        else focus();
      }
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
    const next = key === "reset" ? DEFAULT_FONT_SIZE : Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, (fontSize ?? appSettings().fontSize) + (key === "grow" ? 1 : -1)));

    if (next === fontSize && key !== "reset") return;

    fontSize = next;
    screens.setFontSize(next);
    void saveAppSettings({ fontSize: next }).then(cause => { if (cause !== null) console.warn(copy.terminalZoomNotKept(cause)); });
    refitNextFrame();
  };

  // Z3788a: Find belongs to the focused Terminal and keeps its query while the Pane lives.
  const [finding, setFinding] = createRestartable(terminalId, false);
  const [findQuery, setFindQuery] = createSignal("");

  const closeFind = (): void => {
    setFinding(false);

    const id = terminalId();

    if (id !== null) screens.emulatorFor(id).focus();
  };

  registerKeys({ kind: "region", element: screen }, [
    { action: CHORDS["terminal.text-larger"], chords: ["Meta+[Shift]+=", "Meta+[Shift]++"], run: resize("grow") },
    { action: CHORDS["terminal.text-smaller"], chords: ["Meta+-"], run: resize("shrink") },
    { action: CHORDS["terminal.text-reset"], chords: ["Meta+0"], run: resize("reset") },
    { action: CHORDS["terminal.find"], chords: undefined, run: () => setFinding(true) },
  ].map(({ action, chords, run }) => ({
    action,
    ...chords && { chords },
    repeat: true as const,
    when: (event: KeyboardEvent) => terminalId() !== null && inScreen(event.target instanceof Element ? event.target : null) && connected.daemonExit() === null,
    capture: (focus: Element | null) => {
      const id = terminalId();

      return {
        available: () => id !== null && terminalId() === id && inScreen(focus) && focus?.isConnected === true && connected.daemonExit() === null,
        invoke: run,
      };
    },
  })));

  provideFocusTarget("pane.terminal", () => untrack(screen)?.querySelector<HTMLElement>("textarea, [tabindex]"));

  // U162: the window's native File drop. The ring shows only while a drop would be taken.
  let body: HTMLElement | undefined;

  const dropOver = createFileDrop(connected, () => screens, terminalId, () => body);

  // A Card appearing, growing or going changes the Terminal's room without a window resize.
  const resizeObserver = typeof ResizeObserver === "undefined" ? undefined : makeResizeObserver(refitNextFrame);

  makeEventListener(window, "resize", refitNextFrame);
  onCleanup(() => {
    if (pendingFrame !== null) cancelAnimationFrame(pendingFrame);

    screens.dispose();
  });

  return (
    <div class="pane"><ChangesView />
      <div class="pane-origin">

      <div
        class={["pane-body", { "drop-over": dropOver() }]}
        ref={(element) => {
          body = element;
        }}
      >
        <div class="pane-screen" {...centreState(connected, selected())} ref={element => { setScreen(element); resizeObserver?.observe(element); }} />
        <div class="pane-over">{props.over}</div>{props.header}
        <Show when={playKey()} keyed>
          {(key) => {
            const [agent = "", terminal = ""] = key.split("\n");
            const host = screen();

            return host ? <PlayMarks connected={connected} agent={agent} emulator={screens.emulatorFor(terminal)} host={host} rowHeight={() => screens.rows(terminal)?.height ?? 0} /> : null;
          }}
        </Show>
        <Show when={!preparing() && selected()?.kind === "agent" && terminalId() === null && (notice() === null || notice()?.kind === "command")}>
          <EmptyState art="sitting-reading" {...{ title: copy.noOutputKeptFromAnEarlierRun }} line={copy.emptyOutputLine} />
        </Show>
        <Show when={selected() === null && !["attention", "workstreams", "made"].some(connected.hasView)}>
          <EmptyState art="strolling" {...{ title: copy.noSelectionTitle }} line={copy.noSelectionLine} actions={[
            { label: copy.newAgent, chord: CHORDS["agent.new"], run: () => captureActions(document.activeElement).find(action => action.value === "action:chord:⌘N")?.run() },
            { label: copy.ask, chord: CHORDS["ask.open"], run: () => captureActions(document.activeElement).find(action => action.value === "action:chord:⌘/")?.run() },
          ]} />
        </Show>
        <Show when={selected()?.kind === "group"}>
          <nav class="pane-group" aria-label={selected()!.name}><h3>{selected()!.name}</h3><div class="pane-group-children"><For each={siblingsOf(rail.topology(), selected()!.id)}>{child => <button type="button" class="word pane-action" onClick={() => rail.select(child.id)}>{child.name}</button>}</For></div></nav>
        </Show>
        <Show when={doorState()}>
          {(state) => (
            <div class="pane-door"><EmptyState art="meditating" {...{ title: doorStateText(state(), selected()!.name) }} line={copy.emptyOutputLine} action={<BusyButton kind="primary" class="word pane-action" busy={rail.launching(selected()!.id)} disabled={connected.daemonExit() !== null} busyLabel={copy.starting} onClick={() => rail.startDoor(selected()!.id)}>
                <Icon name="play" />
                {rail.doorRetryable(selected()!.id) ? copy.retry : copy.start}
              </BusyButton>} />
            </div>
          )}
        </Show>
        <Show when={finding() ? terminalId() : null}>
          {(id) => <Find query={findQuery()} setQuery={setFindQuery} find={(query, backwards) => screens.emulatorFor(id()).find?.(query, backwards) ?? false} close={closeFind} />}
        </Show>
        <Show when={latest()}>
          {(id) => (
            <button data-button="quiet" type="button" class="word pane-latest" onClick={() => screens.returnToBottom(id())}>{copy.latest}</button>
          )}
        </Show>
      </div>
      </div>
    </div>
  );
};
