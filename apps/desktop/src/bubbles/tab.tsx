import { makeEventListener } from "@solid-primitives/event-listener";
import * as v from "valibot";
import { createEffect, createMemo, createSignal, onCleanup, onSettled, Show, untrack } from "solid-js";
import type { ConnectedProject } from "../state/connectedProject";
import { createDraftField } from "../state/draftField";
import type { Applied } from "../app/pending";
import type { TerminalInfo } from "@contracts/terminal/TerminalInfo";
import type { Screens } from "../terminal/screens";
import { createCopyFeedback } from "../ui/CopyButton";
import { Editable } from "../ui/Editable";
import { FlatTab } from "../ui/FlatTab";
import { IconButton } from "../ui/IconButton";
import { contextMenu, linkEntries, openOnRelease } from "../ui/contextMenu";
import { Icon } from "../ink/Icon";
import { createCut } from "../ink/Tip";
import { Tip } from "../ui/Tip";
import { ProgramStatusMark, tabLabel } from "../terminal/programStatus";
import { age } from "../shelf/Age";
import { useDisplayNow } from "../state/clock";
import { provideFocusTarget } from "../keys/focus";
import { copy } from "./copy";

/** Calls `leave` each time the App window loses focus, until the returned function runs. */
const onWindowBlur = (leave: () => void) => {
  // listener-owner: the caller runs the returned function to remove it.
  window.addEventListener("blur", leave);

  return () => window.removeEventListener("blur", leave);
};

type Field = ReturnType<typeof createDraftField<any>>;

type ListedDraft = ReturnType<ConnectedProject["drafts"]["list"]>[number];

/** How a rename opens: on nothing, the current draft, a selected one, or a branch off either. */
type Restored = "none" | "current" | "selected" | "branch";

const restoredFor = (retained: ListedDraft | undefined, selecting: boolean, otherThanCurrent: boolean): Restored =>
  retained?.value.recovery === true || (selecting && otherThanCurrent) ? "branch" : selecting ? "selected" : retained ? "current" : "none";

const appliedOrRefused = (failure: string | null): Applied<null> =>
  failure === null ? { kind: "applied", value: null } : { kind: "refused", error: new Error(failure), thrown: failure };

/** On an input's first focus, once the library has left its caret at the end: restores `caret`, else selects the whole text. */
const createFirstFocusSelection = (caret: () => ListedDraft["selection"]) => {
  let done = false;

  return (input: HTMLInputElement) => {
    if (done) return;
    done = true;
    queueMicrotask(() => {
      if (document.activeElement !== input) return;
      const restored = caret();

      if (restored) input.setSelectionRange(restored.start, restored.end, restored.direction);
      else input.select();
    });
  };
};

/** Everything a Terminal tab reads from the Bubbles that owns it. */
export type TabContext = {
  props: { screens: Screens; recovery?: { project: string; revision: string } | undefined };
  connected: ConnectedProject;
  schema: v.GenericSchema<any, any>;
  path: string;
  drafts: ConnectedProject["drafts"];
  records: () => ReturnType<ConnectedProject["drafts"]["list"]>;
  editing: () => { id: string } | null;
  setEditing: (value: { id: string } | null | ((prior: { id: string } | null) => { id: string } | null)) => void;
  shown: () => readonly TerminalInfo[];
  nameFor: (terminal: TerminalInfo) => string;
  placeOf: (id: string) => { min: boolean };
  toggleMinimised: (id: string, wasMin?: boolean) => void;
  openRecovery: (target?: () => HTMLElement | null | undefined) => void;
  readOnly: () => boolean;
  rename: (terminal: TerminalInfo, value: string) => string | null;
  setFailure: (value: { message: string; terminal: { id: string; incarnation: string } | null } | null) => void;
  clearItemFailure: (terminal: { id: string; incarnation: string }) => void;
  lastTarget: () => string | null;
  close: (id: string) => void | Promise<void>;
  bubbleMenus: Map<string, (event: MouseEvent) => void>;
};

export const Tab = (tabProps: { id: string; ctx: TabContext }) => {
  const { props, connected, schema, path, drafts, records, editing, setEditing, shown, nameFor, placeOf, toggleMinimised, openRecovery, readOnly, rename, setFailure, clearItemFailure, lastTarget, close, bubbleMenus } = tabProps.ctx;
  const { rail, app } = connected;
  const id = tabProps.id;
  const terminal = () => shown().find((candidate) => candidate.id === id)!;

  const name = () => nameFor(terminal());
  const [nameRef, nameCut] = createCut();
  let closeButton: HTMLButtonElement | undefined;
  provideFocusTarget(`bubble.${id}.close`, () => closeButton);
  let destination = Object.freeze({ surface: "bubbles", object: untrack(() => terminal().incarnation), recipient: id });
  createEffect(createMemo(() => editing()?.id === id), editingHere => editingHere ? drafts.editor(destination) : undefined);
  const current = () => records().filter(draft => draft.destination.object === terminal().incarnation && draft.destination.recipient === id && draft.status === "draft" && !draft.value.recovery).at(-1);
  let base = "";
  let initial = "";
  let from: { revision: string } | undefined;
  let selection: ListedDraft["selection"] = null;
  let restored: Restored = "none";
  const [changed, change] = createSignal(false);
  // One draft field per rename: a new session opens a new one over the retained revision it started from.
  /** Whether this rename holds a draft: it opened on a retained one, or the owner has typed. */
  const kept = () => restored !== "none" || changed();

  const requiresConfirmation = () => restored === "selected" || restored === "branch";
  const submitMode = () => requiresConfirmation() || (restored === "current" && !changed()) ? "enter" : "both";

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
    restored = restoredFor(retained, selected !== undefined, retained?.revision !== current()?.revision);
    initial = parsed?.success ? parsed.output.name : name();
    base = parsed?.success ? parsed.output.base : name();
    from = retained ? { revision: retained.revision } : undefined;
    selection = retained?.selection ?? null;
    change(false);
    setEditing({ id });
  };

  const capture = (draft: Field, input: HTMLInputElement) => {
    const caret = { start: input.selectionStart ?? 0, end: input.selectionEnd ?? 0, direction: input.selectionDirection ?? "none" };

    // The draft keeps its own revision while it reads the same name; only the caret moves.
    if (draft.draft()?.value.name === input.value) {
      draft.select(caret);

      return;
    }

    // A selected edit is a separate recovery branch; the ordinary current draft stays current.
    draft.keep(restored === "branch" ? { name: input.value, base, recovery: true } : { name: input.value, base }, caret);
  };

  createEffect(createMemo(() => props.recovery), selected => { if (selected) untrack(() => start(selected)); });

  createEffect(createMemo(() => terminal().incarnation !== destination.object || !terminal().running || readOnly()), stale => {
    if (stale) setEditing(prior => prior?.id === id ? null : prior);
  });

  /** Saves the name; the kept draft is sent with it, and a moved original opens recovery. */
  const commit = async (draft: Field, value: string) => {
    const live = rail.terminals().find(candidate => candidate.incarnation === destination.object && candidate.id === id && candidate.running);

    if (!live || readOnly() || base !== nameFor(live)) {
      openRecovery(tab);

      return;
    }

    const renamed = async () => appliedOrRefused(rename(live, value));

    // Enter, a click elsewhere: the owner's own send, so a recovered name goes too. An untouched name has no draft to send.
    if (kept()) draft.save();
    const sent = await (kept() ? draft.send(renamed) : renamed());

    if (sent.kind === "applied") {
      clearItemFailure(live);

      return;
    }

    if (sent.kind === "refused") setFailure({ message: sent.error.message, terminal: live });
    openRecovery(tab);
  };

  const now = useDisplayNow(() => terminal().status !== undefined);

  /** PS12.3: the program's label (the Kind's word when empty) and its age, as the Rail row shows them (PS10.2). */
  const tip = () => {
    const status = terminal().status;

    return status ? `${tabLabel(name(), status)} · ${age(status.since, now())}` : name();
  };

  const tab = () => document.querySelector<HTMLElement>(`button.terminal-tab[data-bubble="${id}"]`);

  /** U2694b: the tab and Bubble share actions and the same rename editor. */
  const copied = createCopyFeedback();
  createEffect(createMemo(() => terminal().incarnation), copied.reset);

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
        <Tip class="ink-tip terminal-tab-tip" content={<span class="terminal-tab-tip-label">{tip()}</span>} cut={() => nameCut() || !!terminal().status}>
          {(trigger) => (
            <button {...trigger({ onClick: () => toggleMinimised(id) })} type="button" data-button="quiet" data-reads={!placeOf(id).min ? "text" : undefined} class="terminal-tab" data-bubble={id}
              aria-label={tabLabel(name(), terminal().status)} aria-describedby={!terminal().status && props.screens.unseen(id) ? `terminal-state-${id}` : undefined} aria-pressed={placeOf(id).min ? "false" : "true"}
              onDblClick={() => start()}>
              <span class="terminal-tab-name" ref={nameRef}>{copied.copied() ? copy.copied : name()}</span>
              <span class="terminal-tab-slot"><Show when={terminal().status} fallback={<Show when={props.screens.unseen(id)}><span id={`terminal-state-${id}`} class="terminal-tab-unseen" data-state="" role="img" aria-label={copy.unseenOutput} /></Show>}>{status => <ProgramStatusMark status={status()} />}</Show></span>
            </button>
          )}
        </Tip>
      }>{_edit => {
        const draft = createDraftField(drafts, destination, schema, from);

        return <div class="terminal-tab terminal-tab-editor" data-bubble={id} data-pressed={String(!placeOf(id).min)}>
          <Editable.Root selectOnFocus={false} defaultValue={initial} activationMode="none" submitMode={submitMode()} finalFocusEl={tab}
            onValueCommit={({ value }) => commit(draft, value)}
            onEditChange={({ edit }) => { if (!edit) setEditing(null); }}>
            <Editable.Context>{(api) => {
              let cancelling = false;
              let field: HTMLInputElement | undefined;

              onSettled(() => {
                api().edit();
                // Switching away from the App saves a changed name; an untouched one stays open.
                const leaveApp = () => { if (submitMode() === "both" && field && field.value !== initial) api().submit(); };

                // onSettled refuses onCleanup, so the cleanup it returns removes the listener.
                return onWindowBlur(leaveApp);
              });

              const select = createFirstFocusSelection(() => selection);

              // The library ends an edit whose text did not change without committing it; Enter still settles a restored draft and reports a moved original.
              const enterOnUnchanged = (event: KeyboardEvent & { currentTarget: HTMLInputElement }) => {
                if (event.key === "Enter" && !event.isComposing && event.currentTarget.value === initial) void commit(draft, initial);
              };

              return <Editable.Area><Editable.Preview /><Editable.Input class="field-inline" spellcheck="false" autocorrect="off" autocapitalize="off" aria-label={copy.terminalName}
              onFocusIn={event => select(event.currentTarget)}
              onBlur={() => { if (!cancelling && submitMode() === "enter") setEditing(null); }}
              onKeyDown={enterOnUnchanged}
              onInput={event => { change(true); capture(draft, event.currentTarget); }}
              onSelect={event => { if (document.activeElement === event.currentTarget && kept()) capture(draft, event.currentTarget); }} ref={(input: HTMLInputElement) => {
              field = input;
              makeEventListener(input, "keydown", event => {
                if (event.key !== "Escape" || event.isComposing) return;

                if (kept() || input.value !== initial) capture(draft, input);
                // Ark blurs before onEditChange; cancellation must close through that callback.
                cancelling = true;
                event.preventDefault();
                event.stopPropagation();
                api().cancel();
              });
            }} /></Editable.Area>;
            }}</Editable.Context>
          </Editable.Root>
          <span class="terminal-tab-slot"><Show when={props.screens.unseen(id)}><span id={`terminal-state-${id}`} class="terminal-tab-unseen" data-state="" role="img" aria-label={copy.unseenOutput} /></Show></span>
        </div>;
      }}
      </Show>
      <IconButton ref={closeButton} aria-label={copy.closeTerminal(name())} onClick={() => void close(id)}><Icon name="x" /></IconButton>
    </FlatTab>
  </>;
};
