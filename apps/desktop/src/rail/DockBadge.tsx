import { createEffect, createMemo } from "solid-js";
import type { Accessor } from "solid-js";
import type { RailNode } from "@contracts/agent/RailNode";
import type { App } from "../app/seam";
import { appSettings } from "../settings/preferences";

/** U10, U182, U5232c: the Dock badge counts the Agents whose Kind has `Dock badge` on (by default `needs-you` and `error`) in every open Project, and is cleared at zero. `onFailure` gets the message of a failed call. No UI of its own. */
export const DockBadge = (props: { app: Pick<App, "setDockBadge">; rails: Accessor<readonly (readonly Pick<RailNode, "status">[])[]>; onFailure: (message: string) => void }) => {
  const count = createMemo(() => {
    const chosen = appSettings().stateAlerts;

    return props.rails().reduce((sum, nodes) => sum + nodes.filter(node => node.status && node.status.kind !== "idle" && chosen[node.status.kind].badge).length, 0);
  });

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
