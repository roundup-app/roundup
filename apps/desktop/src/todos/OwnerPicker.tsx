import { Combobox } from "../ui/Combobox";
import { LEADER } from "../keys/chords";
import { registerKeys } from "../keys/registry";
import { rowButtonOf } from "./triage";
import type { TodosState } from "./state";
import type { ConnectedProject } from "../state/connectedProject";
import { ownersOnRail, sameOwner } from "../shelf/scope";
import { captureFocus } from "../keys/focus";
import { createEffect, createSignal, For, Show } from "solid-js";
import type { Accessor } from "solid-js";
import { Portal } from "solid-js/web";
import type { Actor } from "@contracts/Actor";
import { Menu } from "../ui/Menu";
import { copy } from "./copy";
import type { Owner } from "../shelf/scope";

const NEW_WORKSTREAM = "new-workstream";

/**
 * U3720, U3736: the one list of owners a row's `o` key or `Assign` word opens, over the Shelf below the row. The shared Menu owns arrow keys, Escape and outside dismissal.
 * `target` is the row it is open for; `close` runs after every dismissal so the caller returns focus to that row.
 */
export const OwnerPicker = <Id extends number | string>(props: {
  target: Accessor<{ id: Id; anchor: HTMLElement; focus?: ReturnType<typeof captureFocus> } | null>;
  offers: Accessor<readonly Owner[]>;
  /** The list's accessible name for the row it is open for. */
  label: (id: Id | undefined) => string;
  choose: (id: Id, owner: Actor | null) => void;
  /** U3743: `New Workstream…` for the target Todo, after the picker has closed. */
  newWorkstream?: (id: Id) => void;
  close: () => void;
}) => (
  <Menu.Root initialFocus={props.target()?.focus}
    lazyMount
    unmountOnExit
    open={props.target() !== null && (props.offers().length > 0 || !!props.newWorkstream)}
    positioning={{ placement: "bottom-start", getAnchorRect: () => props.target()?.anchor.getBoundingClientRect() ?? null }}
    onOpenChange={({ open }) => { if (!open) props.close(); }}
    onSelect={({ value }) => {
      const target = props.target();
      const offer = props.offers().find(each => each.id === value);

      if (target && value === NEW_WORKSTREAM) props.newWorkstream?.(target.id);
      else if (target && offer) props.choose(target.id, offer.actor);
    }}
  >
    <Portal>
      <Menu.Positioner>
        <Menu.Content class="owner-picker" aria-label={props.label(props.target()?.id)}>
          <For each={props.offers()}>{offer => <>
            <Show when={props.newWorkstream && offer.id === "unassigned"}><Menu.Item value={NEW_WORKSTREAM}>{copy.newWorkstreamOffer}</Menu.Item></Show>
            <Menu.Item value={offer.id}>{offer.name}</Menu.Item>
          </>}</For>
          <Show when={props.newWorkstream && !props.offers().some(offer => offer.id === "unassigned")}><Menu.Item value={NEW_WORKSTREAM}>{copy.newWorkstreamOffer}</Menu.Item></Show>
        </Menu.Content>
      </Menu.Positioner>
    </Portal>
  </Menu.Root>
);

/** U2539b: the retained Todo selection is captured before the owner filter takes focus. */
export const OwnerCommand = (props: {
  active: Accessor<boolean>;
  selected: () => number | undefined;
  todos: TodosState;
  connected: ConnectedProject;
  assign: (id: number, owner: Actor | null) => Promise<void>;
}) => {
  const [assigning, setAssigning] = createSignal<number | null>(null);
  const [ownerQuery, setOwnerQuery] = createSignal("");
  const [ownerHighlight, setOwnerHighlight] = createSignal<string | null>(null);
  let ownerPanel: HTMLElement | undefined;
  let ownerFocus = captureFocus();

  const eligible = (id: number | undefined | null) => {
    const current = id == null ? undefined : props.todos.byId().get(id);

    return ownersOnRail(props.connected).filter(owner => owner.actor?.kind === "agent" && current && !sameOwner(owner.actor, current.owner));
  };

  const ownerMatches = () => eligible(assigning()).filter(owner => owner.name.toLowerCase().includes(ownerQuery().toLowerCase()));
  createEffect(() => { if (!ownerMatches().some(owner => owner.id === ownerHighlight())) setOwnerHighlight(ownerMatches()[0]?.id ?? null); });
  const assignable = (id: number | undefined) => props.active() && id !== undefined && props.todos.byId().get(id)?.done === false && eligible(id).length > 0;

  // U4453b: an unavailable assignment yields to the Rail's Ask action.
  registerKeys({ kind: "leader" }, [{ action: LEADER.find(row => row.keys === "A")!, when: () => assignable(props.selected()), capture: () => {
    const id = props.selected();

    return { available: () => assignable(id),
      invoke: () => { if (id !== undefined) { ownerFocus = captureFocus(true); setOwnerQuery(""); setAssigning(id); } } };
  } }]);
  registerKeys({ kind: "layer", element: () => ownerPanel, active: () => assigning() !== null, modal: true }, [
    { chords: ["Escape"], run: () => { const id = assigning(); setAssigning(null);

 if (id !== null) rowButtonOf(id)?.focus(); } },
  ]);

  return <>      <Show when={assigning() !== null}><section class="switcher" ref={ownerPanel}>
        <Combobox.Root items={ownerMatches().map(owner => ({ value: owner.id, label: owner.name }))} inputValue={ownerQuery()} onInput={setOwnerQuery} highlightedValue={ownerHighlight()} onHighlightChange={setOwnerHighlight} initialFocus={ownerFocus} focusScope={() => ownerPanel} onDismiss={() => setAssigning(null)} label={copy.assignTodo} placeholder={copy.switcherPlaceholder} empty={copy.noMatch} row={item => item.label} onSelect={value => {
          const id = assigning(); const owner = ownerMatches().find(owner => owner.id === value);
          setAssigning(null);

          if (id !== null && owner && props.todos.byId().get(id)?.done === false) void props.assign(id, owner.actor);
        }} />
      </section></Show>
</>;
};
