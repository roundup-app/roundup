import { copy } from "../copy";
import { createSignal, For } from "solid-js";
import { Portal } from "solid-js/web";
import { Menu } from "../ui/Menu";
import { useConnectedProject } from "../state/connectedProject";
import { homesToOffer } from "./homes";
import "./rowButton.styles.css";

/**
 * U157: the light `move` word of a nested row and the one menu of Homes it opens. The shared Menu owns arrow keys, Escape, outside dismissal and the return of focus to the word.
 * `choose` answers the failure message or `null`; the row shows it and the Todo keeps its Home.
 */
export const HomeMove = (props: {
  id: number;
  home: string | null;
  onOpenChange?: (open: boolean) => void;
  choose: (home: string | null) => Promise<string | null>;
}) => {
  const { rail } = useConnectedProject();
  const [open, setOpen] = createSignal(false);
  const offers = () => homesToOffer(rail.nodes, props.home);

  return (
    <Menu.Root
      open={open() && offers().length > 0}
      onOpenChange={({ open }) => {
        if (open && offers().length === 0) return;
        setOpen(open);
        props.onOpenChange?.(open);
      }}
      onSelect={({ value }) => {
        const offer = offers()[Number(value)];

        if (offer) void props.choose(offer.home);
      }}
    >
      {/* oxlint-disable-next-line anti-slop/no-tooltip-bypass -- U171 requires a focusable disabled button to expose its reason as title. */}
      <Menu.Trigger aria-disabled={offers().length === 0 || undefined} title={offers().length === 0 ? copy.noOtherHomes : undefined}
        onClick={(event) => { if (offers().length === 0) { event.preventDefault(); event.stopPropagation(); } }}
        on:keydown={(event) => { if (offers().length === 0 && ["Enter", " ", "ArrowDown", "ArrowUp"].includes(event.key)) { event.preventDefault(); event.stopPropagation(); } }} data-button="row-action" class="word light todo-move" aria-label={copy.moveTodo(props.id)}>{copy.move}</Menu.Trigger>
      <Portal>
        <Menu.Positioner>
          <Menu.Content aria-label={copy.homesFor(props.id)}>
            <For each={offers()}>{(offer, index) => <Menu.Item value={String(index())}>{offer.name}</Menu.Item>}</For>
          </Menu.Content>
        </Menu.Positioner>
      </Portal>
    </Menu.Root>
  );
};
