import type { ConnectedProject } from "../state/connectedProject";
import type { SortableMove } from "../ui/sortable";
import { createSignal, Show } from "solid-js";
import { Portal } from "solid-js/web";
import { Combobox } from "../ui/Combobox";
import { Popover } from "../ui/Popover";
import { copy } from "../copy";

export const MovePicker = (props: {
  target: { id: string; anchor: HTMLElement } | null;
  destinations: readonly { value: string; label: string }[];
  choose: (id: string, parent: string) => void;
  close: () => void;
}) => <Show when={props.target} keyed>{target => {
  const [query, setQuery] = createSignal("");
  const [highlight, setHighlight] = createSignal<string | null>(null);
  const items = () => props.destinations.filter(item => item.label.toLocaleLowerCase().includes(query().toLocaleLowerCase()));
  let panel: HTMLDivElement | undefined;

  return <Popover.Root open closeOnEscape closeOnInteractOutside finalFocusEl={() => target.anchor}
    onOpenChange={({ open }) => { if (!open) props.close(); }}
    positioning={{ placement: "bottom-start", strategy: "fixed", getAnchorRect: () => target.anchor.getBoundingClientRect() }}>
    <Portal><Popover.Positioner><Popover.Content class="choice-picker" ref={panel} aria-label={copy.moveTo}>
      <Combobox.Root items={items()} inputValue={query()} onInput={setQuery}
        highlightedValue={items().some(item => item.value === highlight()) ? highlight() : items()[0]?.value ?? null} onHighlightChange={setHighlight}
        focusScope={() => panel} onDismiss={() => { props.close(); target.anchor.focus(); }}
        label={copy.moveTo} placeholder={copy.switcherPlaceholder} empty={copy.noMatch} row={item => item.label}
        onSelect={parent => { props.close(); props.choose(target.id, parent); }} />
    </Popover.Content></Popover.Positioner></Portal>
  </Popover.Root>;
}}</Show>;

export const createMove = ({ app, rail }: Pick<ConnectedProject, "app" | "rail">) => {
  const move = async (params: SortableMove): Promise<void> => {
    try {
      await app.rpc("rail.move", params);
      rail.commandFailure.acknowledge(params.id);

      if (params.parent !== null) {
        if (rail.collapsed().has(params.parent)) rail.toggleCollapsed(params.parent);
        const node = rail.nodes.find(node => node.id === params.parent);

        rail.setSectionOpen(node?.opening_prompt?.trim() ? "modes" : "workstreams", true);
      }
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      rail.commandFailure.show(error.message, params.id, "rail", () => { void move(params); });
    }
  };

  return move;
};
