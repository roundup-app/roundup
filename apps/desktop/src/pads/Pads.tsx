import { applied, applying } from "../app/pending";
import { Age } from "../shelf/Age";
import { queueFocus } from "../keys/focus";
import { modalOpen, registerKeys } from "../keys/registry";
import { CHORD_ROWS } from "../keys/chords";
import { CopyButton, createCopyFeedback } from "../ui/CopyButton";
import { contextMenu, linkEntries, openOnRelease } from "../ui/contextMenu";
import * as v from "valibot";
import { NameField, Editable } from "../ui/Editable";
import { createCutTitle } from "../ui/cutTitle";
import { copy } from "./copy";
import { createSelection } from "../shelf/selection";
import { shelfRowKeys } from "../shelf/keys";
import { createBulkDelete, ShelfActions } from "../shelf/BulkDelete";
import { changeFailureOf, failureOf } from "../app/failureOf";
import { Icon } from "../ink/Icon";
import { registerOpener } from "../shelf/openItem";
import { PAD_ICON } from "../shelf/frame";
import { EmptyState } from "../ink/EmptyState";

import { createEffect, createMemo, createSelector, createSignal, For, on, onCleanup, Show, untrack, useContext } from "solid-js";
import type { Accessor, Setter } from "solid-js";
import type { Pad } from "@contracts/pad/Pad";
import { dismissable, ReservedLine } from "../ink/ReservedLine";
import { OpenButton } from "../ink/OpenButton";
import { ShelfRow } from "../ink/ShelfRow";
import { useConnectedProject, useCreation } from "../state/connectedProject";
import { createFailure } from "./failure";
import { PadDrawer } from "./PadDrawer";
import { padGroups, shownPads } from "./shownPads";
import { shelfScope } from "../shelf/scope";
import { ScopeAction } from "../shelf/ScopeAction";
import { OwnerGroups } from "../shelf/OwnerGroups";
import { Sortable } from "../ui/sortable";
import { createDraftField } from "../state/draftField";
import { usePadList } from "./padList";
import type { PadList } from "./padList";

/** The Shelf's `pads` list; `pad.list` logs no Touch, so refetching it on every `pad.changed` leaves no trace in Provenance. One fetch serves the list and any open Drawer. */
export const Pads = (props: {
  /** Open this Project's retained creation revision without submitting it. */
  recovery?: { project: string; revision: string; list: PadList };
}) => {
  const connected = useConnectedProject();
  const shelf = useContext(ShelfActions);

  if (props.recovery && props.recovery.project !== connected.project.path) return null;

  const list = props.recovery?.list ?? usePadList();
  const pads = list.pads;
  const creation = { surface: "pads", object: "creation", recipient: null };

  const retentionProblem = () => {
    const problem = connected.drafts.problem();

    return problem && (!problem.destination || (problem.destination.surface === creation.surface && problem.destination.object === creation.object)) ? problem : invalid() ? { cause: "invalid" } : null;
  };

  const nameLabel = copy.copyField(copy.draftField("name").toLowerCase());
  const restored = connected.drafts.list().filter(draft => draft.destination.surface === "pads" && draft.destination.object === "creation" && draft.destination.recipient === null && (props.recovery?.revision === undefined || draft.revision === props.recovery?.revision)).at(-1);
  const [naming, setNaming] = createSignal(props.recovery?.revision !== undefined && restored !== undefined);
  createEffect(() => { if (naming()) onCleanup(connected.drafts.editor(creation)); });
  const parsed = restored ? v.safeParse(v.object({ name: v.string(), home: v.nullable(v.string()) }), restored.value) : null;
  const [invalid, setInvalid] = createSignal(Boolean(parsed && !parsed.success));
  const [name, setName] = createSignal(parsed?.success ? parsed.output.name : "");
  const draft = createDraftField(connected.drafts, creation, v.object({ name: v.string(), home: v.nullable(v.string()) }));
  let input: HTMLInputElement | undefined;
  let home = parsed?.success ? parsed.output.home : null;
  const kept = () => draft.value().success;

  const capture = () => {
    if (invalid()) return;

    // A recovered revision stays as it was until its text or Home changes.
    if (parsed?.success && !draft.owned() && name() === parsed.output.name && home === parsed.output.home) return;
    const caret = input ? { start: input.selectionStart ?? 0, end: input.selectionEnd ?? 0, direction: input.selectionDirection ?? "none" } : null;
    draft.keep({ name: name(), home }, caret, restored?.revision);
  };

  const forget = () => { void draft.discard(); setName(""); };

  let plusButton: HTMLButtonElement | undefined;
  const failure = createFailure();
  const listNote = dismissable(() => list.failure() ?? (retentionProblem() ? copy.draftRetention(connected.project.name, copy.pad, retentionProblem()!.cause) : null));
  const [itemFailure, setItemFailure] = createSignal<{ incarnation: string; message: string; action: string } | null>(null);

  const reportItemFailure = (pad: Pad, message: string | null, action: string) => {
    if (message !== null) {
      // A late reply for a deleted source must not resurrect its error on the list.
      if (pads().some(current => current.incarnation === pad.incarnation)) setItemFailure({ incarnation: pad.incarnation, message, action });
    } else {
      if (itemFailure()?.incarnation === pad.incarnation) setItemFailure(null);
    }
  };

  createEffect(() => {
    const failed = itemFailure();

    if (failed && !pads().some(pad => pad.incarnation === failed.incarnation)) setItemFailure(null);
  });
  const scope = shelfScope(connected);

  const create = () =>
    failure.run(async () => {
      if (!name().trim()) return;
      capture();
      const target = name().trim();
      const targetHome = home;
      let action: string = copy.addPad;
      draft.save();

      const sent = await draft.send(async () => {
        await applied(() => connected.app.rpc("pad.create", { name: target, text: null }));

        if (targetHome !== null) {
          action = copy.moveItem(target);
          await applied(() => connected.app.rpc("pad.move", { name: target, home: targetHome }));
        }
      });

      try {
        if (sent.kind === "unknown") failure.show(copy.draftStatus.unknown);
        // Only the submitted revision is consumed; text typed since stays.
        else if (sent.kind === "applied" && name().trim() === target) setName("");
        else if (sent.kind === "refused") throw new Error(copy.failed(action, sent.error.message));
      } finally {
        await list.reload();
      }
    });

  const shown = shownPads(connected, list);
  const groups = createMemo(() => padGroups(connected, shown()));
  const selection = createSelection(() => shown().map((pad) => pad.incarnation), () => connected.rail.selected() ?? "overview", incarnation => document.querySelector<HTMLButtonElement>(`.pads-tab [data-incarnation="${CSS.escape(incarnation)}"] .pad-name`));

  const bulk = createBulkDelete({
    app: connected.app,
    rail: connected.rail,
    selected: selection.selected,
    afterRemoval: selection.afterRemoval,
    focused: selection.focused,
    targets: () => shown().map((pad) => ({ id: pad.incarnation, label: pad.name })),
    context: () => connected.rail.selected() ?? "overview",
    noun: copy.pads, replace: selection.replace, clear: selection.clear, cancelSelection: selection.cancel,
    blocked: () => connected.drafts.undo.pending() || connected.drafts.undo.uncertain(),
    remove: (ids) => connected.drafts.undo.removePads(pads().filter(pad => ids.includes(pad.incarnation)), shelf ? "shelf" : "pads"),
    reload: async () => {
      await list.reload();

      return list.failure();
    },
  });

  shelfRowKeys({
    focused: selection.focused, clicked: selection.clicked, move: selection.move,
    exportPad: async incarnation => {
      const pad = pads().find(pad => pad.incarnation === incarnation);

      if (!pad) return;
      const name = pad.name;

      const message = await failureOf(async () => {
        const path = await connected.app.chooseSavePath([name, ".md"].join(""));

        if (path !== null) await connected.app.rpc("pad.export", { name, path });
      });

      if (message !== null) reportItemFailure(pad, message, copy.exportMd);
    },
    remove: name => bulk.ask(false, name),
  });

  let lifted: Pad | undefined;

  const reorder = async (ids: string[]) => {
    const source = lifted;

    if (!source || !pads().some(pad => pad.incarnation === source.incarnation && pad.name === source.name)) return;
    const before = ids[ids.indexOf(source.name) + 1] ?? null;
    const message = await changeFailureOf(() => connected.app.rpc("pad.reorder", { name: source.name, before, expectedIncarnation: source.incarnation }));

    reportItemFailure(source, message, copy.moveItem(source.name));
    await list.reload();
  };

  const [dragging, setDragging] = createSignal(false);
  const rowButtons = new Map<string, HTMLButtonElement>();

  useCreation("pad", targetHome => {
    if (kept() && home !== targetHome) forget();

    home = targetHome;
    setNaming(true);
  });

  const openField = () => {
    failure.clear();

    if (!kept()) home = scope.home();
    setNaming(true);
  };

  const isEmpty = createMemo(() => list.loaded() && shown().length === 0);

  return (
    <section data-history-region={shelf ? "shelf" : "pads"} aria-label={copy.pads} class="pads-tab">
      <ScopeAction tab="pads">
        <button
          data-button="add"
          type="button"
          aria-label={copy.addPad}
          class="shelf-add"
          ref={(button) => (plusButton = button)}
          onClick={() => {
            openField();
          }}
        >
          <Icon name="plus" />
          <span>{copy.pad}</span>
        </button>
      </ScopeAction>
      <ReservedLine content={itemFailure() ? <>{copy.failed(itemFailure()!.action, "")}<span>{itemFailure()!.message}</span></> : undefined} message={itemFailure()?.message ?? failure.message() ?? listNote.message()} dismiss={() => itemFailure() ? setItemFailure(null) : failure.message() ? failure.clear() : listNote.dismiss()} recover={retentionProblem() ? { run: () => connected.drafts.retry(), label: copy.storageRetry } : undefined} action={<>
        <Show when={retentionProblem()}>
        <CopyButton app={connected.app} text={name()} onSuccess={() => failure.clear()} onFailure={error => failure.show(copy.copyDraftFailure(String(error)))}>{nameLabel}</CopyButton>
        <button data-button="quiet" type="button" onClick={() => { forget(); setInvalid(false); }}>{copy.discardRevision}</button>

      </Show></>} />
      <Show when={isEmpty() && !naming() && !failure.message() && !list.failure() && !itemFailure()}>
        <EmptyState art="reading-side" {...{ title: copy.noPadsYet }} line={copy.emptyPadsLine} action={<button type="button" data-button="primary" onClick={() => openField()}>{copy.addPadWord}</button>} />
      </Show>
      <OwnerGroups groups={groups} dragging={dragging} reveal={() => null}>{group => <PadRows
        selection={selection}
        bulk={bulk}
        pads={pads}
        shown={() => group().items}
        onItemFailure={reportItemFailure}
        rowButtons={rowButtons}
        onOrderChange={ids => void reorder(ids)}
        onLift={pad => { lifted = { ...pad }; }}
        onDrag={setDragging}
      />}</OwnerGroups>
      <Show when={naming()}>
        <div class="shelf-list">
          <ShelfRow glyph={<Icon name={PAD_ICON} />} class="entry-row pad-inset">
            <Editable.Root edit value={name()} readOnly={invalid()} selectOnFocus={false} submitMode="none" onValueChange={({ value }) => { setName(value); capture(); }}>
            <Editable.Input spellcheck={false} autocorrect="off" autocapitalize="off" type="text" class="entry-field shelf-title field-inline" aria-label={copy.padName} placeholder={copy.newPadPlaceholder} value={name()}
              ref={(element) => {
                input = element;
                queueFocus(() => {
                  if (!element.isConnected) return;
                  element.focus();

                  if (restored?.selection) element.setSelectionRange(restored.selection.start, restored.selection.end, restored.selection.direction);
                });
              }}
              onInput={(event) => { setName(event.currentTarget.value); capture(); }}
              onSelect={() => { if (kept()) capture(); }}
              on:keydown={(event) => {
                if (event.key === "Enter" && name().trim()) { event.preventDefault(); void create(); }
                else if (event.key === "Escape" || (event.key === "Enter" && !name().trim())) {
                  event.preventDefault();
                  setNaming(false);
                  plusButton?.focus();
                }
              }}
              onBlur={() => { if (!name().trim()) setNaming(false); }} />
            </Editable.Root>
          </ShelfRow>
        </div>
      </Show>

      <bulk.Bar />
    </section>
  );
};

const PadRows = (props: {
  selection: ReturnType<typeof createSelection<string>>;
  bulk: ReturnType<typeof createBulkDelete<string>>;
  pads: Accessor<readonly Pad[]>;
  shown: Accessor<readonly Pad[]>;
  onItemFailure: (pad: Pad, message: string | null, action: string) => void;
  rowButtons: Map<string, HTMLButtonElement>;
  onOrderChange: (ids: string[]) => void;
  onLift: (pad: Pad) => void;
  onDrag: Setter<boolean>;
}) => {
  const isSelected = createSelector(() => props.selection.selected(), (incarnation: string, chosen) => chosen.includes(incarnation));

  return (
    <Sortable.Root class="shelf-list" plain ids={props.shown().map(pad => pad.name)} onOrderChange={props.onOrderChange} onDrag={props.onDrag}>
      <For each={props.shown()}>
        {(pad, at) => (
          <Sortable.Item id={pad.name} index={at()}>{parts => <PadRow pad={pad} parts={parts} isSelected={isSelected} {...props} />}</Sortable.Item>
        )}
      </For>
    </Sortable.Root>
  );
};

const selectedPad = (selection: Parameters<typeof PadRows>[0]["selection"], incarnation: string, name: string) => (selection.focused() ?? selection.selected()[0]) === incarnation ? name : undefined;

const PadRow = (props: Parameters<typeof PadRows>[0] & { pad: Pad; isSelected: (incarnation: string) => boolean; parts: Parameters<Parameters<typeof Sortable.Item>[0]["children"]>[0] }) => {
  const connected = useConnectedProject();
  const pad = props.pad;
  const copied = createCopyFeedback();
  const useList = usePadList();
  const [editing, setEditing] = createSignal(false);
  // U5172a: a rename that got no reply shows the asked name, marked busy, until the Daemon's Event or a re-read changes the name.
  const [asked, setAsked] = createSignal<string | null>(null);

  createEffect(on(() => pad.name, () => setAsked(null), { defer: true }));

  let row: HTMLButtonElement | undefined;

  const closeName = (restore = true) => { setEditing(false);

 if (restore) queueMicrotask(() => document.querySelector<HTMLElement>(`[data-incarnation="${CSS.escape(pad.incarnation)}"] .pad-name`)?.focus()); };

  const open = (source: "key" | "pointer") => {
    const name = pad.name;
    connected.drawer.open(() => <PadDrawer name={name} pads={props.pads} onLateFailure={message => props.onItemFailure(pad, message, copy.openDraft)} onFailureCleared={() => props.onItemFailure(pad, null, copy.openDraft)} />, source, { kind: "pad", project: connected.project.path });
  };

  // U5240b: the Switcher opens a Pad through its Rail row, as a click then Enter on it does. U3721a: the focused or first selected row answers `⌘K B`.
  onCleanup(registerOpener("pad", name => {
    if (name !== pad.name) return false;
    props.selection.replace([pad.incarnation]);
    open("key");

    return true;
  }, () => untrack(() => selectedPad(props.selection, pad.incarnation, pad.name))));

  const rename = () => { setEditing(true); };

  registerKeys({ kind: "layer", element: () => row, active: () => document.activeElement === row && !modalOpen(), modal: false }, CHORD_ROWS.filter(action => action.name === "todo.open-draft" || action.name === "rail.rename").map(action => ({
    action, searchable: false as const,
    when: (event: KeyboardEvent) => event.target === row && !event.isComposing,
    capture: (focus: Element | null) => {
      const name = pad.name;
      const incarnation = pad.incarnation;

      return {
        available: () => focus === row && row?.isConnected === true && document.activeElement === row
          && !row.closest("[hidden], [inert]") && !editing() && !props.bulk.pending() && !modalOpen()
          && props.shown().some(current => current.incarnation === incarnation && current.name === name),
        invoke: () => { if (action.name === "todo.open-draft") open("key"); else rename(); },
      };
    },
  })));

  const nameCut = createCutTitle(() => pad.name);

  return (
          <ShelfRow
            ref={props.parts.ref}
            data-pad={pad.name}
            onClick={event => {
              if (!editing() && !props.bulk.pending() && event.target instanceof Element && !event.target.closest("button, input")) { props.selection.click(pad.incarnation, event); row?.focus(); }
            }}
            onDblClick={event => {
              if (!editing() && event.target instanceof Element && !event.target.closest("button, input")) open("pointer");
            }}
            data-incarnation={pad.incarnation}
            data-editing={editing()}
            data-selected={props.isSelected(pad.incarnation) ? "true" : undefined}
            data-shelf-row
            onContextMenu={(event: MouseEvent) => openOnRelease(event, (x, y) => void contextMenu(connected.app, [
              { id: "open", label: copy.openDraft, run: () => open("pointer") },
              { id: "rename", label: copy.rename, run: rename },
              ...linkEntries(connected.app, { kind: "pad", id: pad.name }, connected.rail.nodes, (node) => connected.rail.exitOf(node) === null, message => props.onItemFailure(pad, message, copy.link), () => props.onItemFailure(pad, null, copy.link), copied),
              { id: "delete", label: copy.delete, run: () => { props.selection.replace([pad.incarnation]); props.bulk.ask(); } },
            ], x, y))}
            class="pad-inset"
            glyph={<Icon name={PAD_ICON} />}
          >
            <div class="pad-row-head">
            <Show when={!editing()} fallback={<NameField object={`pad:${pad.incarnation}`} name={pad.name}
              version={async () => pad.incarnation} commit={async (text, base, version) => {
                const result = await applying(() => connected.app.rpc("pad.rename", { name: base, newName: text, expectedIncarnation: version! }));

                if (result.kind === "refused") throw result.error;

                if (result.kind === "pending") setAsked(text);

                await useList.reload();
              }} close={closeName} fail={message => props.onItemFailure(pad, message, copy.rename)} />}>
            <button
              type="button"
              class="pad-name"
              aria-busy={asked() !== null ? true : undefined}
              aria-pressed={props.selection.selected().includes(pad.incarnation)}
              ref={(element) => {
                row = element;
                props.selection.register(pad.incarnation, element);

                if (element) props.rowButtons.set(pad.name, element);
                else props.rowButtons.delete(pad.name);
              }}
              on:keydown={(event) => {
                props.bulk.key(event);

                if (!event.defaultPrevented && !props.bulk.pending()) props.selection.key(pad.incarnation, event);
              }}
              onDblClick={() => open("pointer")}
              onClick={(event) => { if (!props.bulk.pending()) props.selection.click(pad.incarnation, event); row?.focus(); }}

            >
              <span {...nameCut.attrs()} class="shelf-title">{copied.copied() ? copy.copied : asked() ?? pad.name}</span>
            </button>
            </Show>
            <Show when={!editing()}>
              <Age updatedAt={pad.updated_at} />
              <OpenButton name={pad.name} onOpen={() => open("pointer")} />
              <Sortable.Handle label={copy.moveItem(pad.name)} ref={props.parts.handleRef} onLift={() => props.onLift(pad)} />
            </Show>
            </div>
          </ShelfRow>
  );
};
