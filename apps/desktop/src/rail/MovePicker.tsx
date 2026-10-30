import { applying } from "../app/pending";
import type { ConnectedProject } from "../state/connectedProject";
import type { SortableMove } from "../ui/sortable";
import { createSignal, Show } from "solid-js";
import { Portal } from "solid-js/web";
import { Combobox } from "../ui/Combobox";
import { Popover } from "../ui/Popover";
import { copy } from "./copy";
import { captureFocus, queueFocus } from "../keys/focus";

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

  const close = () => {
    props.close();
    queueFocus(() => target.anchor.focus({ preventScroll: true }));
  };

  return <Popover.Root open closeOnEscape closeOnInteractOutside finalFocusEl={() => target.anchor}
    onOpenChange={({ open }) => { if (!open) close(); }}
    positioning={{ placement: "bottom-start", strategy: "fixed", getAnchorRect: () => target.anchor.getBoundingClientRect() }}>
    <Portal><Popover.Positioner><Popover.Content class="choice-picker" ref={element => { panel = element; }} aria-label={copy.moveTo}>
      <Combobox.Root items={items()} inputValue={query()} onInput={setQuery}
        highlightedValue={items().some(item => item.value === highlight()) ? highlight() : items()[0]?.value ?? null} onHighlightChange={setHighlight}
        focusScope={() => panel} onDismiss={close}
        label={copy.moveTo} placeholder={copy.moveTo} empty={copy.noMatch} row={item => item.label}
        onSelect={parent => {
          close();
          // Return to the source row after unmount before the move captures focus ownership.
          queueMicrotask(() => props.choose(target.id, parent));
        }} />
    </Popover.Content></Popover.Positioner></Portal>
  </Popover.Root>;
}}</Show>;

export const createMove = ({ app, rail, daemonExit }: Pick<ConnectedProject, "app" | "rail" | "daemonExit">, rowElement: (id: string) => HTMLElement | undefined) => {
  const [target, setTarget] = createSignal<{ id: string; anchor: HTMLElement } | null>(null);
  const destinations = () => rail.nodes.filter(node => node.kind === "workstream").map(node => ({ value: node.id, label: node.name }));
  const available = (id: string | undefined) => daemonExit() === null && rail.nodes.some(node => node.id === id && node.kind === "agent" && node.parent === null) && destinations().length > 0;

  const open = (id: string) => {
    const anchor = rowElement(id);

    if (anchor && available(id)) { anchor.focus(); setTarget({ id, anchor }); }
  };

  const move = async (params: SortableMove): Promise<void> => {
    const focus = rowElement(params.id) === document.activeElement ? captureFocus() : undefined;

    try {
      const result = await applying(() => app.rpc("rail.move", params));

      if (result.kind === "refused") throw result.error;

      if (result.kind === "pending") await rail.refresh();
      rail.commandFailure.acknowledge(params.id);

      if (params.parent !== null) {
        if (rail.collapsed().has(params.parent)) rail.toggleCollapsed(params.parent);
        const node = rail.nodes.find(node => node.id === params.parent);

        rail.setSectionOpen(node?.opening_prompt?.trim() ? "modes" : "workstreams", true);
      }

      await rail.settled();
      focus?.(() => rowElement(params.id)?.focus({ preventScroll: true }));
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      rail.commandFailure.show(error.message, params.id, "rail", () => { void move(params); });
    }
  };

  return { move, target, destinations, available, open, close: () => setTarget(null) };
};
