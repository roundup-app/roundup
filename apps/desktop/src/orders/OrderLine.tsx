import { copy } from "../copy";
import type { RailNode } from "@contracts/agent/RailNode";
import { Show } from "solid-js";
import { useConnectedProject } from "../state/connectedProject";
import { OrderDrawer } from "./OrderDrawer";
import { orderLine } from "./orderText";
import "./styles.css";

/**
 * O6: the selected Agent's or Door's order on one line above its Terminal, below any Decision Card. Activating it opens
 * the full order in the Drawer. A node with no order (a Terminal) shows no line.
 */
export const OrderLine = (props: { node: RailNode }) => {
  const { drawer } = useConnectedProject();

  return (
    <Show when={props.node.work === null ? null : orderLine(props.node.work)}>
      {(line) => (
        <button
          data-button="quiet"
          type="button"
          class="word order-line"
          aria-label={copy.orderOf(props.node.name)}
          onClick={() => {
            const id = props.node.id;
            drawer.open(() => <OrderDrawer id={id} />);
          }}
        >
          {line()}
        </button>
      )}
    </Show>
  );
};
