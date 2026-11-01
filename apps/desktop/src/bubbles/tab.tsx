import * as v from "valibot";
import { createEffect, createSignal, on, onCleanup, onMount, Show } from "solid-js";
import type { ConnectedProject } from "../state/connectedProject";
import type { TerminalInfo } from "@contracts/terminal/TerminalInfo";
import type { Screens } from "../terminal/screens";
import { captureFocus } from "../keys/focus";
import { createCopyFeedback } from "../ui/CopyButton";
import { Editable } from "../ui/Editable";
import { FlatTab } from "../ui/FlatTab";
import { IconButton } from "../ui/IconButton";
import { contextMenu, linkEntries, openOnRelease } from "../ui/contextMenu";
import { Icon } from "../ink/Icon";
import { createCut } from "../ink/Tip";
import { Tip } from "../ui/Tip";
import { ProgramStatusMark, tabLabel } from "../terminal/programStatus";
import { copy } from "./copy";

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
        <Tip class="ink-tip terminal-tab-tip" content={<span class="terminal-tab-tip-label">{tabLabel(name(), terminal().status)}</span>} cut={() => nameCut() || !!terminal().status}>
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
