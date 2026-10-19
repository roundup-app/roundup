import { Tip } from "../ui/Tip";
import { activationSource } from "../keys/registry";
import { copy } from "../copy";
import { createSelection } from "../shelf/selection";
import { createBulkDelete } from "../shelf/BulkDelete";
import { failureOf } from "../todos/failureOf";
import { OwnerMark } from "../ink/OwnerMark";
import { Icon } from "../ink/Icon";
import { EmptyState } from "../ink/EmptyState";
import { EntryRow } from "../ink/EntryRow";
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

/** The Shelf's `pads` list; `pad.list` logs no Touch, so refetching it on every `pad.changed` leaves no trace in Provenance. One fetch serves the list and any open Drawer. */
export const Pads = () => {
  const connected = useConnectedProject();
  const list = usePadList();
  const pads = list.pads;
  const [naming, setNaming] = createSignal(false);
  let plusButton: HTMLButtonElement | undefined;
  const failure = createFailure();
  const scope = shelfScope(connected);

  const create = (name: string) =>
    failure.run(async () => {
      const home = scope.home();

      await connected.app.rpc("pad.create", { name, text: null });

      // U347: a Pad added while a Workstream is selected goes to that Workstream, so `this one` shows it.
      if (home !== null) await connected.app.rpc("pad.move", { name, home });
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
          <EntryRow
            glyph={<span class="light"><OwnerMark owner={USER} decorative /></span>}
            class="pad-inset"
            label={copy.padName}
            placeholder={copy.newPadPlaceholder}
            onSubmit={(name) => void create(name)}
            onClose={(reason) => {
              setNaming(false);

              if (reason !== "blur") plusButton?.focus();
            }}
          />
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
