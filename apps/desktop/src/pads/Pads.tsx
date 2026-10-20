import * as v from "valibot";
import { Editable } from "../ui/Editable";
import { RpcError, INTERNAL_CODE } from "../app/seam";
import { Tip } from "../ui/Tip";
import { activationSource } from "../keys/registry";
import { copy } from "../copy";
import { createSelection } from "../shelf/selection";
import { createBulkDelete } from "../shelf/BulkDelete";
import { failureOf } from "../todos/failureOf";
import { OwnerMark } from "../ink/OwnerMark";
import { Icon } from "../ink/Icon";
import { EmptyState } from "../ink/EmptyState";

import { createMemo, createSignal, For, Show } from "solid-js";
import type { Accessor } from "solid-js";
import type { Pad } from "@contracts/pad/Pad";
import { ErrorLine } from "../ink/ErrorLine";
import { ShelfRow } from "../ink/ShelfRow";
import { useConnectedProject } from "../state/connectedProject";
import { createFailure } from "./failure";
import { PadDrawer } from "./PadDrawer";
import { USER } from "./owner";
import { shownPads } from "./shownPads";
import { shelfScope } from "../shelf/scope";
import { Groups } from "../shelf/Groups";
import { usePadList } from "../rail/pads/padList";
import type { PadList } from "../rail/pads/padList";

/** The Shelf's `pads` list; `pad.list` logs no Touch, so refetching it on every `pad.changed` leaves no trace in Provenance. One fetch serves the list and any open Drawer. */
export const Pads = (props: {
  /** Open this Project's retained creation revision without submitting it. */
  recovery?: { project: string; revision: string; list: PadList };
}) => {
  const connected = useConnectedProject();

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
  const parsed = restored ? v.safeParse(v.object({ name: v.string(), home: v.nullable(v.string()) }), restored.value) : null;
  const [invalid, setInvalid] = createSignal(Boolean(parsed && !parsed.success));
  const [name, setName] = createSignal(parsed?.success ? parsed.output.name : "");
  let revision = restored?.revision;
  let field: HTMLInputElement | undefined;
  let home = parsed?.success ? parsed.output.home : null;
  let caret = restored?.selection ?? null;
  let captured = restored ? JSON.stringify([restored.value.name, restored.value.home, caret]) : null;

  const capture = () => {
    if (invalid()) return;
    caret = field ? { start: field.selectionStart ?? 0, end: field.selectionEnd ?? 0, direction: field.selectionDirection ?? "none" } : caret;
    const fingerprint = JSON.stringify([name(), home, caret]);

    if (captured === fingerprint) return;
    captured = fingerprint;
    revision = connected.drafts.edit(creation, { name: name(), home }, caret, "ordinary", revision ?? null).draft.revision;
  };

  let plusButton: HTMLButtonElement | undefined;
  const failure = createFailure();
  const scope = shelfScope(connected);

  const create = () =>
    failure.run(async () => {
      if (!name().trim()) return;
      capture();
      const submitted = revision ? connected.drafts.submit(revision) : null;

      if (!submitted) return;
      const target = name().trim();
      const targetHome = home;

      const timeout = setTimeout(() => {
        connected.drafts.settle(submitted.draft.revision, "unknown");
        failure.show(copy.draftStatus.unknown);
      }, 15_000);

      try {
        await connected.app.rpc("pad.create", { name: target, text: null });
        connected.drafts.settle(submitted.draft.revision, "acknowledged");

        if (revision === submitted.draft.revision) {
          revision = undefined;
          captured = null;
          setName("");
        }

        // The creation reply acknowledges only its captured name; a later edit remains current.
        if (targetHome !== null) await connected.app.rpc("pad.move", { name: target, home: targetHome });
      } catch (error) {
        connected.drafts.settle(submitted.draft.revision, error instanceof RpcError && error.code !== INTERNAL_CODE ? "failed" : "unknown");
        throw error;
      } finally {
        clearTimeout(timeout);
      }
    });

  const makeYours = (name: string) =>
    failure.run(async () => {
      await connected.app.rpc("pad.setOwner", { name, owner: USER });
      await list.reload();
    });

  const shown = shownPads(connected, list);

  const selection = createSelection(() => shown().map((pad) => pad.name), () => connected.rail.selected() ?? "overview");

  const bulk = createBulkDelete({
    selected: selection.selected,
    targets: () => shown().map((pad) => ({ id: pad.name, label: pad.name, owner: pad.owner.kind === "agent" ? connected.rail.nameOf(pad.owner) : undefined })),
    context: () => connected.rail.selected() ?? "overview",
    noun: copy.pads, replace: selection.replace, clear: selection.clear, cancelSelection: selection.cancel,
    remove: (name) => failureOf(() => connected.app.rpc("pad.delete", { name })),
    reload: async () => {
      await list.reload();

      return list.failure();
    },
  });

  const isEmpty = createMemo(() => list.loaded() && pads().length === 0 && list.failure() === null);

  return (
    <section aria-label={copy.pads}>
      <button
        data-button="add"
        type="button"
        aria-label={copy.addPad}
        class="shelf-add"
        ref={(button) => (plusButton = button)}
        onClick={() => {
          failure.clear();

          if (!revision) home = scope.home();
          setNaming(true);
        }}
      >
        <Icon name="plus" />
        <span>{copy.pad}</span>
      </button>
      <Show when={failure.message()}>
        {(message) => <ErrorLine message={message()} />}
      </Show>
      <Show when={list.failure()}>
        {(message) => <ErrorLine message={message()} />}
      </Show>
      <Show when={isEmpty() && !naming()}>
        <EmptyState icon="order" heading={copy.noPadsYet} hint={copy.noPadsHint} />
      </Show>
      <Groups items={shown} home={pad => pad.home} maker={pad => pad.owner}>{items => <PadRows
        selection={selection}
        bulk={bulk}
        pads={pads}
        shown={items}
        onMakeYours={(name) => void makeYours(name)}
        onLateFailure={failure.show}
      />}</Groups>
      <Show when={naming()}>
        <div class="shelf-list">
          <ShelfRow glyph={<span class="light"><OwnerMark owner={USER} decorative /></span>} class="entry-row pad-inset">
            <Editable.Root edit value={name()} readOnly={invalid()} selectOnFocus={false} submitMode="none" onValueChange={({ value }) => { setName(value); capture(); }}>
            <Editable.Input class="entry-field shelf-title" aria-label={copy.padName} placeholder={copy.newPadPlaceholder} value={name()}
              ref={(input) => {
                field = input;
                queueMicrotask(() => {
                  if (!input.isConnected) return;
                  input.focus();

                  if (caret) input.setSelectionRange(caret.start, caret.end, caret.direction);
                  else if (restored) {
                    // Focus supplies an uncaptured caret; retaining it would replace the current creation draft.
                    caret = { start: input.selectionStart ?? 0, end: input.selectionEnd ?? 0, direction: input.selectionDirection ?? "none" };
                    captured = JSON.stringify([name(), home, caret]);
                  }
                });
              }}
              onInput={(event) => { setName(event.currentTarget.value); capture(); }}
              onSelect={() => { if (revision) capture(); }}
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
      <Show when={retentionProblem()}>{(problem) => <div role="alert" class="pad-retention pad-retention-shelf">
        <p>{copy.draftRetention(connected.project.path, copy.pad, problem().cause)}</p>
        <div class="diff-actions">
        <button data-button="primary" type="button" onClick={() => connected.drafts.retry()}>{copy.storageRetry}</button>
        <button data-button="quiet" type="button" onClick={() => void navigator.clipboard.writeText(name()).catch(error => failure.show(copy.copyDraftFailure(String(error))))}>{nameLabel}</button>
        <button data-button="quiet" type="button" onClick={() => { if (revision) connected.drafts.discard(revision); revision = undefined; captured = null; setName(""); setInvalid(false); }}>{copy.discardRevision}</button>
        </div>
      </div>}</Show>
      <bulk.Bar />
    </section>
  );
};

const PadRows = (props: {
  selection: ReturnType<typeof createSelection<string>>;
  bulk: ReturnType<typeof createBulkDelete<string>>;
  pads: Accessor<readonly Pad[]>;
  shown: Accessor<readonly Pad[]>;
  onMakeYours: (name: string) => void;
  onLateFailure: (message: string) => void;
}) => {
  const connected = useConnectedProject();

  return (
    <div class="shelf-list">
      <For each={props.shown()}>
        {(pad) => (
          <ShelfRow
            data-selected={props.selection.selected().includes(pad.name) ? "true" : undefined}
            data-shelf-row
            class="pad-inset"
            glyph={
              <Show
                when={pad.owner.kind === "user"}
                fallback={
                  <button data-button="icon"
                    type="button"
                    class="word"
                    aria-label={copy.makePadYours(pad.name)}
                    onClick={() => props.onMakeYours(pad.name)}
                  >
                    <OwnerMark owner={pad.owner} />
                  </button>
                }
              >
                <span class="light">
                  <OwnerMark owner={pad.owner} />
                </span>
              </Show>
            }
          >
            <button
              type="button"
              class="pad-name"
              aria-pressed={props.selection.selected().includes(pad.name)}
              ref={(row) => props.selection.register(pad.name, row)}
              on:keydown={(event) => {
                props.bulk.key(event);

                if (!event.defaultPrevented && !props.bulk.pending()) props.selection.key(pad.name, event);
              }}
              onClick={(event) => !props.bulk.pending() && props.selection.click(pad.name, event, () =>
                connected.drawer.open(() => (
                  <PadDrawer
                    name={pad.name}
                    pads={props.pads}
                    onLateFailure={props.onLateFailure}
                  />
                ), activationSource(event)))
              }
            >
              <Tip text={pad.name}>{(trigger) => <span {...trigger()} class="shelf-title">{pad.name}</span>}</Tip>
            </button>
            <p class="shelf-meta">{copy.ownedBy}{connected.rail.nameOf(pad.owner)}</p>
          </ShelfRow>
        )}
      </For>
    </div>
  );
};
