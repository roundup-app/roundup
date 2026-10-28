import { activationSource } from "../keys/registry";
import { copy } from "../copy";
import type { RailNode } from "@contracts/agent/RailNode";
import { Show, onCleanup, lazy } from "solid-js";
import { useConnectedProject } from "../state/connectedProject";
import { orderLine } from "./orderText";
import "./styles.css";

const OrderDrawer = lazy(() => import("./OrderDrawer").then(module => ({ default: module.OrderDrawer })));

/**
 * O6: the selected Agent's or Door's order on one line above its Terminal. Activating it opens
 * the full order in the Drawer. A node with no order (a Terminal) shows no line.
 */
export const OrderLine = (props: { node: RailNode }) => {
  const { drawer, project } = useConnectedProject();
  let opened: (() => ReturnType<typeof OrderDrawer>) | undefined;

  onCleanup(() => {
    if (opened !== undefined && drawer.content() === opened) drawer.close();
  });

  return (
    <Show when={props.node.work}>
      {(order) => (
        <button
          data-button="quiet"
          type="button"
          class="word order-line"
          aria-label={copy.orderOf(props.node.name)}
          onMouseEnter={() => OrderDrawer.preload()}
          onFocus={() => OrderDrawer.preload()}
          onClick={(event) => {
            const id = props.node.id;
            opened = () => <OrderDrawer id={id} />;
            drawer.open(opened, activationSource(event), { kind: "work-order", project: project.path });
          }}
        >
          {orderLine(order())}
        </button>
      )}
    </Show>
  );
};
