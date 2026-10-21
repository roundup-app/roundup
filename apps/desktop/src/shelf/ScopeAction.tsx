import { Show, useContext } from "solid-js";
import type { JSX } from "solid-js";
import { Portal } from "solid-js/web";
import { useTabsContext } from "@ark-ui/solid/tabs";
import { ShelfActions } from "./BulkDelete";

/** U3730: the open tab's add control sits at the trailing end of the Shelf's scope line; without a Shelf it stays where it is rendered. */
export const ScopeAction = (props: { tab: string; children: JSX.Element }) => {
  const host = useContext(ShelfActions);

  if (!host) return props.children;

  const tabs = useTabsContext();

  return <Show when={host.scope()}>
    {(mount) => <Portal mount={mount()}><span class="shelf-scope-action" hidden={tabs().value !== props.tab}>{props.children}</span></Portal>}
  </Show>;
};
