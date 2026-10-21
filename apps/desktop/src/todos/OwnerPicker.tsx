import { For, Show } from "solid-js";
import type { Accessor } from "solid-js";
import { Portal } from "solid-js/web";
import type { Actor } from "@contracts/Actor";
import { Menu } from "../ui/Menu";
import { copy } from "../copy";
import type { Owner } from "../shelf/scope";

const NEW_WORKSTREAM = "new-workstream";

/**
 * U3720: the one list of owners a row's `o` key or `Assign` word opens, over the Shelf below the row. The shared Menu owns arrow keys, Escape and outside dismissal.
 * `target` is the row it is open for; `close` runs after every dismissal so the caller returns focus to that row.
 */
export const OwnerPicker = (props: {
  target: Accessor<{ id: number; anchor: HTMLElement } | null>;
  offers: Accessor<readonly Owner[]>;
  choose: (id: number, owner: Actor | null) => void;
  /** U3743: `New Workstream…` for the target Todo, after the picker has closed. */
  newWorkstream: (id: number) => void;
  close: () => void;
}) => (
  <Menu.Root
    lazyMount
    unmountOnExit
    open={props.target() !== null}
    positioning={{ placement: "bottom-start", getAnchorRect: () => props.target()?.anchor.getBoundingClientRect() ?? null }}
    onOpenChange={({ open }) => { if (!open) props.close(); }}
    onSelect={({ value }) => {
      const target = props.target();
      const offer = props.offers().find(each => each.id === value);

      if (target && value === NEW_WORKSTREAM) props.newWorkstream(target.id);
      else if (target && offer) props.choose(target.id, offer.actor);
    }}
  >
    <Portal>
      <Menu.Positioner>
        <Menu.Content class="owner-picker" aria-label={copy.ownersFor(props.target()?.id ?? "")}>
          <For each={props.offers()}>{offer => <>
            <Show when={offer.id === "unassigned"}><Menu.Item value={NEW_WORKSTREAM}>{copy.newWorkstreamOffer}</Menu.Item></Show>
            <Menu.Item value={offer.id}>{offer.name}</Menu.Item>
          </>}</For>
          <Show when={!props.offers().some(offer => offer.id === "unassigned")}><Menu.Item value={NEW_WORKSTREAM}>{copy.newWorkstreamOffer}</Menu.Item></Show>
        </Menu.Content>
      </Menu.Positioner>
    </Portal>
  </Menu.Root>
);
