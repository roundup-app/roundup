import type { RailNode } from "@contracts/agent/RailNode";
import { Show } from "solid-js";
import { OrderDrawer } from "../orders/OrderDrawer";
import { useConnectedProject } from "../state/connectedProject";
import { ClearPrompt } from "./ClearPrompt";
import { clearingOf } from "./clear";
import { firstSentence } from "./lines";
import { MoreMenu } from "./MoreMenu";
import type { MoreItem } from "./MoreMenu";

/**
 * U422: the Workstream's goal as the Thread's header: the order's first sentence on one line, a button that opens the whole
 * order in the Drawer (O6), and `⋯` at the column's right edge.
 */
export const ThreadHeader = (props: { node: RailNode; taken: boolean; running: boolean; onToggle: () => void; messages: { shown: boolean; toggle: () => void } | null }) => {
  const { app, drawer, events } = useConnectedProject();
  const clearing = () => clearingOf(app, events, props.node.id);

  const openOrder = () => {
    const id = props.node.id;

    drawer.open(() => <OrderDrawer id={id} />);
  };

  const items = (): MoreItem[] => [
    ...(props.node.work ? [{ icon: "order" as const, label: "Whole order", run: openOrder }] : []),
    ...(props.taken || props.running ? [{ icon: "takeover" as const, label: props.taken ? "End takeover" : "Take over", run: props.onToggle }] : []),
    ...(props.node.kind === "workstream" && clearing().phase() === "closed" ? [{ icon: "clear" as const, label: "Clear…", run: () => clearing().open() }] : []),
    ...(props.messages ? [{ icon: "messages" as const, label: props.messages.shown ? "Hide messages" : "All messages", run: props.messages.toggle }] : []),
  ];

  return (
    <header class="thread-header thread-column" data-thread-header>
      <Show when={props.node.work} fallback={<span class="thread-goal" />}>
        {(order) => {
          const whole = () => {
            const each = order();

            return each.kind === "work" ? each.ask : each.question;
          };

          return (
            <button type="button" class="word thread-order" aria-label={`order of ${props.node.name}`} title={whole()} onClick={openOrder}>
              <span class="thread-goal" data-goal>{firstSentence(whole())}</span>
            </button>
          );
        }}
      </Show>
      <MoreMenu items={items()} />
      <Show when={props.node.kind === "workstream"}>
        <ClearPrompt node={props.node} />
      </Show>
    </header>
  );
};
