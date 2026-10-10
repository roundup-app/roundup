import { createEffect, createMemo } from "solid-js";
import type { Accessor } from "solid-js";
import type { RailNode } from "@contracts/agent/RailNode";
import type { App } from "../app/seam";
import { attentionCount } from "./attention";

/** U10, U182: the Dock badge counts the Agents of Kind `needs-you` or `error` in every open Project, and is cleared at zero. `onFailure` gets the message of a failed call. No UI of its own. */
export const DockBadge = (props: { app: Pick<App, "setDockBadge">; rails: Accessor<readonly (readonly RailNode[])[]>; onFailure: (message: string) => void }) => {
  const count = createMemo(() => props.rails().reduce((sum, nodes) => sum + attentionCount(nodes), 0));

  const show = async (shown: number) => {
    try {
      await props.app.setDockBadge(shown);
    } catch (error) {
      if (!(error instanceof Error)) throw error;

      props.onFailure(error.message);
    }
  };

  createEffect(() => {
    void show(count());
  });

  return null;
};
