import type { captureFocus } from "../keys/focus";
import { For, type Accessor } from "solid-js";
import { Menu } from "../ui/Menu";
import { copy } from "./copy";
import { pickerAnchor } from "./pickerAnchor";
import type { Home } from "./homes";

/**
 * U3753: the one list of Homes a triage row's `w` key opens below the row, as OwnerPicker does for owners.
 * `close` runs after every dismissal so the caller returns focus to that row.
 */
export const HomePicker = (props: {
  target: Accessor<{ id: number; anchor: HTMLElement; focus?: ReturnType<typeof captureFocus> } | null>;
  offers: Accessor<readonly Home[]>;
  /** U6236b: the live row of a Todo whose element a re-render replaced. */
  replacement?: () => HTMLElement | null | undefined;
  choose: (id: number, home: string | null) => void;
  close: () => void;
}) => {
  const anchor = pickerAnchor(props);

  return (
  <Menu.Root initialFocus={props.target()?.focus}
    open={props.target() !== null && props.offers().length > 0}
    onOpenChange={({ open }) => { if (!open) props.close(); }}
    onAction={value => {
      const target = props.target();
      const offer = props.offers()[Number(value)];

      if (target && offer) props.choose(target.id, offer.home);
    }}
  >
    <Menu.Content side="bottom" align="start" anchor={anchor} class="owner-picker" aria-label={copy.homesFor(props.target()?.id ?? "")}>
      <For each={props.offers()}>{(offer, index) => <Menu.Item value={String(index())}>{offer.name}</Menu.Item>}</For>
    </Menu.Content>
  </Menu.Root>
  );
};
