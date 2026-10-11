import { OwnerMark } from "../ink/OwnerMark";
import { Icon } from "../ink/Icon";
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
import { useShelfScope } from "../todos/shelfScope";
import { usePadList } from "../rail/pads/padList";

/** The Shelf's `pads` list; `pad.list` logs no Touch, so refetching it on every `pad.changed` leaves no trace in Provenance. One fetch serves the list and any open Drawer. */
export const Pads = () => {
  const connected = useConnectedProject();
  const list = usePadList();
  const pads = list.pads;
  const [naming, setNaming] = createSignal(false);
  const failure = createFailure();
  const scope = useShelfScope(connected);

  const create = (name: string) =>
    failure.run(async () => {
      setNaming(false);
      const home = scope.workstream();

      await connected.app.rpc("pad.create", { name, text: null });

      // U347: a Pad added while a Workstream is selected goes to that Workstream, so `this one` shows it.
      if (home !== null) await connected.app.rpc("pad.move", { name, home });
    });

  const makeYours = (name: string) =>
    failure.run(async () => {
      await connected.app.rpc("pad.setOwner", { name, owner: USER });
      await list.reload();
    });

  const thisWorkstream = createMemo(() => scope.workstream() !== null && !scope.showAll());

  const shown = shownPads(connected, list);

  const isEmpty = createMemo(() => list.loaded() && pads().length === 0 && list.failure() === null);
  const noneInWorkstream = createMemo(() => thisWorkstream() && list.loaded() && pads().length > 0 && shown().length === 0 && list.failure() === null);

  return (
    <section aria-label="pads">
      <button
        data-button="add"
        type="button"
        aria-label="add pad"
        class="shelf-add"
        onClick={() => {
          failure.clear();
          setNaming(true);
        }}
      >
        <Icon name="plus" />
        <span>pad</span>
      </button>
      <Show
        when={failure.message()}
        fallback={
          <Show when={naming()}>
            <NameField onName={create} onCancel={() => setNaming(false)} />
          </Show>
        }
      >
        {(message) => <ErrorLine message={message()} />}
      </Show>
      <Show when={list.failure()}>
        {(message) => <ErrorLine message={message()} />}
      </Show>
      <Show when={isEmpty()}>
        <p>no pads yet</p>
      </Show>
      <Show when={noneInWorkstream()}>
        <p>
          no pads in this workstream{" "}
          <button data-button="quiet" type="button" onClick={() => scope.setShowAll(true)}>
            show all
          </button>
        </p>
      </Show>
      <PadRows
        pads={pads}
        shown={shown}
        onMakeYours={(name) => void makeYours(name)}
        onLateFailure={failure.show}
      />
    </section>
  );
};

const PadRows = (props: {
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
            data-shelf-row
            glyph={
              <Show
                when={pad.owner.kind === "user"}
                fallback={
                  <button data-button="icon"
                    type="button"
                    class="word"
                    aria-label={`make ${pad.name} yours`}
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
              title={pad.name}
              class="pad-name"
              onClick={() =>
                connected.drawer.open(() => (
                  <PadDrawer
                    name={pad.name}
                    pads={props.pads}
                    onLateFailure={props.onLateFailure}
                  />
                ))
              }
            >
              <span class="shelf-title">{pad.name}</span>
            </button>
            <p class="shelf-meta">owned by {connected.rail.nameOf(pad.owner)}</p>
          </ShelfRow>
        )}
      </For>
    </div>
  );
};

const NameField = (props: {
  onName: (name: string) => void;
  onCancel: () => void;
}) => (
  <input
    aria-label="pad name"
    ref={(field) => queueMicrotask(() => field.focus())}
    onKeyDown={(key) => {
      if (key.key === "Enter") props.onName(key.currentTarget.value);
      else if (key.key === "Escape") props.onCancel();
    }}
  />
);
