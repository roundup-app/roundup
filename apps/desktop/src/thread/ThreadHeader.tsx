import type { Order } from "@contracts/agent/Order";
import type { RailNode } from "@contracts/agent/RailNode";
import { Show } from "solid-js";
import { OrderDrawer } from "../orders/OrderDrawer";
import { useConnectedProject } from "../state/connectedProject";
import { limitsText } from "./lines";

const askText = (order: Order): string => (order.kind === "work" ? order.ask : limitsText(order));

/**
 * U197: the Workstream's order as the Thread's header. The ask is the button that opens the order in the Drawer (O6);
 * under it, the limits count, with `take over` (`end takeover` during a Takeover) at the column's right edge.
 */
export const ThreadHeader = (props: { node: RailNode; taken: boolean; running: boolean; onToggle: () => void }) => {
  const { drawer } = useConnectedProject();

  return (
    <header class="thread-header thread-column" data-thread-header>
      <Show when={props.node.work}>
        {(order) => (
          <>
            <button
              type="button"
              class="word thread-order"
              aria-label={`order of ${props.node.name}`}
              onClick={() => {
                const id = props.node.id;

                drawer.open(() => <OrderDrawer id={id} />);
              }}
            >
              <span class="thread-ask" data-full={order().kind === "clarification" ? "" : undefined}>{askText(order())}</span>
            </button>
            <Show when={order().kind === "work"}>
              <p class="thread-limits">{limitsText(order())}</p>
            </Show>
          </>
        )}
      </Show>
      <Show when={props.taken || props.running}>
        <button type="button" class="word thread-toggle" onClick={props.onToggle}>
          {props.taken ? "end takeover" : "take over"}
        </button>
      </Show>
    </header>
  );
};
