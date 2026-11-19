import { makeEventListener } from "@solid-primitives/event-listener";
import { applied, applying } from "../app/pending";
import { Age } from "../shelf/Age";
import { exportPad } from "./padExport";
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

import { createEffect, createMemo, createProjection, createSignal, For, onCleanup, Show, untrack, useContext, type Accessor, type Setter } from "solid-js";
import type { Pad } from "@contracts/pad/Pad";
import { dismissable } from "../ink/recovery";
import { createMessageToast } from "../ink/messageToast";
import { failedLabel } from "../ink/failedLabel";
import { OpenButton } from "../ink/OpenButton";
import { ShelfRow } from "../ink/ShelfRow";
import { useConnectedProject, useCreation } from "../state/connectedProject";
import { createFailure, type Failure } from "./failure";
import type { App } from "../app/seam";
import { PadDrawer } from "./PadDrawer";
import { padGroups, shownPads } from "./shownPads";
import { shelfScope } from "../shelf/scope";
import { ScopeAction } from "../shelf/ScopeAction";
import { OwnerGroups } from "../shelf/OwnerGroups";
import { Sortable } from "../ui/sortable";
import { createDraftField } from "../state/draftField";
import { usePadList } from "./padList";
import type { PadMark } from "./padRead";
import { createFolds, type FoldedPads } from "./padFolds";
import { FoldContent } from "../ui/FoldRow";
import { Trunks } from "../ui/TreeView";
import { createRowReveal } from "../ui/rowReveal";
import type { PadList } from "./padList";

/** The Pad name a retention failure keeps: Copy it, or discard it. */
const NameRecovery = (props: { app: Pick<App, "writeClipboardText">; text: string; failure: Failure; label: string; discard: () => void }) => <>
  <CopyButton app={props.app} text={props.text} onSuccess={() => props.failure.clear()} onFailure={error => props.failure.show(copy.copyDraftFailure(String(error)))}>{props.label}</CopyButton>
  <button data-button="quiet" type="button" onClick={() => props.discard()}>{copy.discardRevision}</button>
</>;

/** The failure of one action on one Pad. It shows while that Pad is listed: a late reply for a deleted source never brings its error back. */
const createPadFailure = (pads: () => readonly Pad[]) => {
  const [itemFailure, setItemFailure] = createSignal<{ incarnation: string; message: string; action: string } | null>(null);

  const reportItemFailure = (pad: Pad, message: string | null, action: string) => {
    if (message !== null) {
      if (pads().some(current => current.incarnation === pad.incarnation)) setItemFailure({ incarnation: pad.incarnation, message, action });
    } else {
      if (itemFailure()?.incarnation === pad.incarnation) setItemFailure(null);
    }
  };

  createEffect(createMemo(() => {
    const failed = itemFailure();

    return failed !== null && !pads().some(pad => pad.incarnation === failed.incarnation);
  }), (orphaned) => {
    if (orphaned) setItemFailure(null);
  });

  const itemLabel = () => {
    const item = itemFailure();

    return item ? failedLabel(item.action, item.message) : undefined;
  };

  return { itemFailure, setItemFailure, reportItemFailure, itemLabel };
};

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
  const restored = untrack(() => connected.drafts.list().filter(draft => draft.destination.surface === "pads" && draft.destination.object === "creation" && draft.destination.recipient === null && (props.recovery?.revision === undefined || draft.revision === props.recovery?.revision)).at(-1));
  const [naming, setNaming] = createSignal(props.recovery?.revision !== undefined && restored !== undefined);
  createEffect(naming, (active) => active ? connected.drafts.editor(creation) : undefined);
  const parsed = restored ? v.safeParse(v.object({ name: v.string(), home: v.nullable(v.string()) }), restored.value) : null;
  const [invalid, setInvalid] = createSignal(Boolean(parsed && !parsed.success));
  const [name, setName] = createSignal(parsed?.success ? parsed.output.name : "");
  const draft = createDraftField(connected.drafts, creation, v.object({ name: v.string(), home: v.nullable(v.string()) }), restored);
  let input: HTMLInputElement | undefined;
  let home = parsed?.success ? parsed.output.home : null;
  const kept = () => draft.value().success;

  const capture = (text = name()) => {
    if (invalid()) return;
    const caret = input ? { start: input.selectionStart ?? 0, end: input.selectionEnd ?? 0, direction: input.selectionDirection ?? "none" } : null;
    draft.keep({ name: text, home }, caret);
  };

  const forget = () => { void draft.discard(); setName(""); };

  let plusButton: HTMLButtonElement | undefined;
  const failure = createFailure();
  const listNote = dismissable(() => list.failure() ?? (retentionProblem() ? copy.draftRetention(connected.project.name, copy.pad, retentionProblem()!.cause) : null));
  const { itemFailure, setItemFailure, reportItemFailure, itemLabel } = createPadFailure(pads);
  createMessageToast({
    get message() { return itemFailure()?.message ?? failure.message() ?? listNote.message(); }, dismiss: () => itemFailure() ? setItemFailure(null) : failure.message() ? failure.clear() : listNote.dismiss(),
    get content() { return itemLabel(); }, get recover() { return retentionProblem() ? { run: () => connected.drafts.retry(), label: copy.storageRetry } : undefined; },
    get action() { return <Show when={retentionProblem()}><NameRecovery app={connected.app} text={name()} failure={failure} label={nameLabel} discard={() => { forget(); setInvalid(false); }} /></Show>; },
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

      const sent = await draft.send(() => applying(async () => {
        await applied(() => connected.app.rpc("pad.create", { name: target, text: null })); padRead.created(target); // U7499b: the user's own Pad is read at its creation.

        if (targetHome !== null) {
          action = copy.moveItem(target);
          await applied(() => connected.app.rpc("pad.move", { name: target, home: targetHome }));
        }
      }));

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
  const groups = createMemo(() => padGroups(connected, shown())); const { walked, of, read: padRead } = createFolds(groups, connected.now, list);
  const selection = createSelection(() => walked().map((pad) => pad.incarnation), () => connected.rail.selected() ?? "overview", incarnation => document.querySelector<HTMLButtonElement>(`.pads-tab [data-incarnation="${CSS.escape(incarnation)}"] .pad-name`));

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
        await exportPad(connected.app, name);
      });

      if (message !== null) reportItemFailure(pad, message, copy.exportMd);
    },
    remove: name => bulk.ask(false, name),
  });

  const reorder = async (ids: string[], moved: string) => {
    const source = pads().find(pad => pad.name === moved);

    if (!source || !pads().some(pad => pad.incarnation === source.incarnation && pad.name === source.name)) return;
    const before = ids[ids.indexOf(source.name) + 1] ?? null;
    const message = await changeFailureOf(() => connected.app.rpc("pad.reorder", { name: source.name, before, expectedIncarnation: source.incarnation }));

    // U7276c: a key's move keeps focus on the row, which the redraw may have replaced.
    const focused = rowButtons.get(source.name) === document.activeElement;

    reportItemFailure(source, message, copy.moveItem(source.name));
    await list.reload();

    if (focused && (document.activeElement === document.body || document.activeElement === null)) rowButtons.get(source.name)?.focus({ preventScroll: true });
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
      <Show when={isEmpty() && !naming() && !failure.message() && !list.failure() && !itemFailure()}>
        <EmptyState art="reading-side" {...{ title: copy.noPadsYet }} line={copy.emptyPadsLine} action={<button type="button" data-button="primary" onClick={() => openField()}>{copy.addPadWord}</button>} />
      </Show>
      <OwnerGroups groups={groups} dragging={dragging} reveal={() => null}>{group => <PadRows {...of(group)}
        selection={selection}
        bulk={bulk}
        pads={pads}
        shown={() => group().items}
        onItemFailure={reportItemFailure}
        rowButtons={rowButtons}
        onOrderChange={(ids, moved) => void reorder(ids, moved)}
        onDrag={setDragging}
      />}</OwnerGroups>
      <Show when={naming()}>
        <div class="shelf-list">
          <ShelfRow glyph={<Icon name={PAD_ICON} />} class="entry-row pad-inset">
            <Editable.Root edit value={name()} readOnly={invalid()} selectOnFocus={false} submitMode="none" onValueChange={({ value }) => { setName(value); capture(value); }}>
            <Editable.Input spellcheck="false" autocorrect="off" autocapitalize="off" type="text" class="entry-field shelf-title field-inline" aria-label={copy.padName} placeholder={copy.newPadPlaceholder} value={name()}
              ref={(element) => {
                input = element;
                makeEventListener(element, "keydown", (event) => {
                  if (event.key === "Enter" && name().trim()) { event.preventDefault(); void create(); }
                  else if (event.key === "Escape" || (event.key === "Enter" && !name().trim())) {
                    event.preventDefault();
                    setNaming(false);
                    plusButton?.focus();
                  }
                });
                queueFocus(() => {
                  if (!element.isConnected) return;
                  element.focus();

                  if (restored?.selection) element.setSelectionRange(restored.selection.start, restored.selection.end, restored.selection.direction);
                });
              }}
              onInput={(event) => { const { value } = event.currentTarget; setName(value); capture(value); }}
              onSelect={() => { if (kept()) capture(); }}
              onBlur={() => { if (!name().trim()) setNaming(false); }} />
            </Editable.Root>
          </ShelfRow>
        </div>
      </Show>

      <bulk.Bar />
    </section>
  );
};

/** U7637a: a Home group is level 1 of the Pads tab's tree, so its fold rows and the Pads above them are level 2. */
const PAD_LEVEL = 2;

const PadRows = (props: {
  folded: Accessor<FoldedPads>;
  isFoldOpen: (fold: "internal" | "idle") => boolean;
  toggleFold: (fold: "internal" | "idle") => void;
  selection: ReturnType<typeof createSelection<string>>;
  bulk: ReturnType<typeof createBulkDelete<string>>;
  pads: Accessor<readonly Pad[]>;
  shown: Accessor<readonly Pad[]>;
  onItemFailure: (pad: Pad, message: string | null, action: string) => void;
  rowButtons: Map<string, HTMLButtonElement>;
  onOrderChange: (ids: string[], moved: string) => void;
  onDrag: Setter<boolean>;
}) => {
  const picked = createProjection(() => Object.fromEntries(props.selection.selected().map(incarnation => [incarnation, true])));
  const isSelected = (incarnation: string) => picked[incarnation] === true;

  // U7499a: a drag orders the Pads above the folds only; `pad.reorder` takes its `before` from the full Home order, where those Pads keep their slots.
  const fullOrder = (above: string[]) => {
    const ranks = new Set(props.folded().above.map(each => each.pad.name));
    const queue = [...above];

    return props.shown().map(pad => ranks.has(pad.name) ? queue.shift() ?? pad.name : pad.name);
  };

  const onOrderChange = (ids: string[], moved: string) => props.onOrderChange(fullOrder(ids), moved);

  const foldRows = (fold: "internal" | "idle") => (
    <Show when={props.folded()[fold].length > 0}>
      <button type="button" role="treeitem" aria-level={PAD_LEVEL} class="pad-fold row-wash row-wash-inert" data-fold={fold} aria-expanded={props.isFoldOpen(fold) ? "true" : "false"}
        onClick={() => props.toggleFold(fold)}
        onKeyDown={event => {
          if (event.key === "ArrowRight" && !props.isFoldOpen(fold)) { event.preventDefault(); props.toggleFold(fold); }
          else if (event.key === "ArrowLeft" && props.isFoldOpen(fold)) { event.preventDefault(); props.toggleFold(fold); }
        }}>
        <FoldContent stem="pad-fold" label={copy.foldLabel(props.folded()[fold].length, fold)} />
        <Icon name="right" />
        <Trunks depth={0} trail={[]} stem={props.isFoldOpen(fold)} />
      </button>
      <Show when={props.isFoldOpen(fold)}>
        <div class="shelf-list" role="group">
          <For each={props.folded()[fold]}>{(pad, at) => <PadRow {...props} pad={pad} mark={null} parts={undefined} nested={{ last: at() === props.folded()[fold].length - 1 }} isSelected={isSelected} onOrderChange={onOrderChange} />}</For>
        </div>
      </Show>
    </Show>
  );

  const allFoldRows = () => (["internal", "idle"] as const).map(foldRows);

  return (
    <>
      <Sortable.Root class="shelf-list" role="group" ids={props.folded().above.map(each => each.pad.name)} onOrderChange={onOrderChange} onDrag={props.onDrag}>
        <For each={props.folded().above} keyed={each => each.pad.incarnation}>
          {(each, at) => (
            <Sortable.Item id={each().pad.name} index={at()}>{parts => <PadRow {...props} pad={each().pad} mark={each().mark} parts={parts} isSelected={isSelected} onOrderChange={onOrderChange} />}</Sortable.Item>
          )}
        </For>
      </Sortable.Root>
      {allFoldRows()}
    </>
  );
};

const CHORD_STEPS = new Map([["ArrowUp", -1], ["ArrowDown", 1]]);

/** U7276c: the list `⌥↑` or `⌥↓` makes by moving `name` one slot, null where it would leave the list, or undefined for any other press. */
const chordOrder = (event: KeyboardEvent, names: readonly string[], name: string): string[] | null | undefined => {
  const by = event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey ? CHORD_STEPS.get(event.key) : undefined;

  if (by === undefined) return undefined;

  const at = names.indexOf(name);
  const order = names.filter(each => each !== name);

  if (event.repeat || at < 0 || at + by < 0 || at + by >= names.length) return null;
  order.splice(at + by, 0, name);

  return order;
};

const selectedPad = (selection: Parameters<typeof PadRows>[0]["selection"], incarnation: string, name: string) => (selection.focused() ?? selection.selected()[0]) === incarnation ? name : undefined;

const PadRow = (props: Parameters<typeof PadRows>[0] & { pad: Pad; mark: PadMark; /** U7637a: a Pad in an open fold, one level below its fold row; `last` ends its elbow. */ nested?: { last: boolean }; isSelected: (incarnation: string) => boolean; parts: Parameters<Parameters<typeof Sortable.Item>[0]["children"]>[0] | undefined }) => {
  const connected = useConnectedProject();
  const pad = props.pad;
  const copied = createCopyFeedback();
  const useList = usePadList();
  const [editing, setEditing] = createSignal(false);
  // U5172a: a rename that got no reply shows the asked name, marked busy, until the Daemon's Event or a re-read changes the name.
  const [asked, setAsked] = createSignal<string | null>(null);

  createEffect(() => pad.name, () => { setAsked(null); }, { defer: true });

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
  const reveal = createRowReveal(() => props.isSelected(pad.incarnation));

  return (
          <ShelfRow
            {...reveal}
            // A row in a fold has no sortable parts. Solid's compiler drops an optional-chain ref, so the ref is a function.
            ref={element => props.parts?.ref(element)}
            data-pad={pad.name}
            onClick={event => {
              if (!editing() && !props.bulk.pending() && event.target instanceof Element && !event.target.closest("button, input")) { props.selection.click(pad.incarnation, event); row?.focus(); }
            }}
            onDblClick={event => {
              if (!editing() && event.target instanceof Element && !event.target.closest("button, input")) open("pointer");
            }}
            data-incarnation={pad.incarnation}
            data-editing={String(editing())}
            data-selected={props.isSelected(pad.incarnation) ? "true" : undefined}
            data-shelf-row
            onContextMenu={(event: MouseEvent) => openOnRelease(event, (x, y) => void contextMenu(connected.app, [
              { id: "open", label: copy.openDraft, run: () => open("pointer") },
              { id: "rename", label: copy.rename, run: rename },
              ...linkEntries(connected.app, { kind: "pad", id: pad.name }, connected.rail.nodes, (node) => connected.rail.exitOf(node) === null, message => props.onItemFailure(pad, message, copy.link), () => props.onItemFailure(pad, null, copy.link), copied),
              { id: "delete", label: copy.delete, run: () => { props.selection.replace([pad.incarnation]); props.bulk.ask(false, pad.incarnation); } },
            ], x, y))}
            // A row the list owns, with no tab stop of its own, so the drag library stamps it neither a button nor a second tab stop (U7276c).
            class="pad-inset" role="treeitem" aria-level={props.nested ? PAD_LEVEL + 1 : PAD_LEVEL} style={props.nested ? { "--todo-depth": 1 } : undefined} tabindex="-1"
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
              data-drag-surface=""
              aria-busy={asked() !== null ? "true" : undefined}
              aria-pressed={props.selection.selected().includes(pad.incarnation) ? "true" : "false"}
              ref={(element) => {
                row = element;
                props.selection.register(pad.incarnation, element);
                makeEventListener(element, "keydown", (event) => {
                  // U7276c: one chord press is one `pad.reorder`.
                  const order = chordOrder(event, props.folded().above.map(each => each.pad.name), pad.name);

                  if (order !== undefined) {
                    event.preventDefault();

                    if (order && !editing() && !props.bulk.pending()) props.onOrderChange(order, pad.name);

                    return;
                  }

                  props.bulk.key(event);

                  if (!event.defaultPrevented && !props.bulk.pending()) props.selection.key(pad.incarnation, event);
                });

                if (element) props.rowButtons.set(pad.name, element);
                else props.rowButtons.delete(pad.name);
              }}
              onDblClick={() => open("pointer")}
              onClick={(event) => { if (!props.bulk.pending()) props.selection.click(pad.incarnation, event); row?.focus(); }}

            >
              <span {...nameCut.attrs()} class="shelf-title">{copied.copied() ? copy.copied : asked() ?? pad.name}</span>
            </button>
            </Show>
            <Show when={!editing()}>
              <span class="pad-mark-slot">
                <Show when={props.mark}>{mark => <span class="unread-dot pad-mark" data-mark={mark()} role="img" aria-label={mark() === "new" ? copy.newPad : copy.changedPad} />}</Show>
              </span>
              <Age updatedAt={pad.updated_at} />
              <OpenButton name={pad.name} onOpen={() => open("pointer")} />
            </Show>
            </div>
            <Show when={props.nested}>{nested => <Trunks depth={1} trail={[!nested().last]} stem={false} />}</Show>
          </ShelfRow>
  );
};
