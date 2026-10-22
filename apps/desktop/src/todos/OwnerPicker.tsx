import { For } from "solid-js";
import type { Accessor } from "solid-js";
import { Portal } from "solid-js/web";
import type { Actor } from "@contracts/Actor";
import { Menu } from "../ui/Menu";
import { copy } from "../copy";
import type { Owner } from "../shelf/scope";

/**
 * U3720, U3736: the one list of owners a row's `o` key or `Assign` word opens, over the Shelf below the row. The shared Menu owns arrow keys, Escape and outside dismissal.
 * `target` is the row it is open for; `close` runs after every dismissal so the caller returns focus to that row.
 */
export const OwnerPicker = <Id extends number | string>(props: {
  target: Accessor<{ id: Id; anchor: HTMLElement } | null>;
  offers: Accessor<readonly Owner[]>;
  /** The list's accessible name for the row it is open for. */
  label: (id: Id | undefined) => string;
  choose: (id: Id, owner: Actor | null) => void;
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

      if (target && offer) props.choose(target.id, offer.actor);
    }}
  >
    <Portal>
      <Menu.Positioner>
        <Menu.Content class="owner-picker" aria-label={props.label(props.target()?.id)}>
          <For each={props.offers()}>{offer => <Menu.Item value={offer.id}>{offer.name}</Menu.Item>}</For>
        </Menu.Content>
      </Menu.Positioner>
    </Portal>
  </Menu.Root>
);
