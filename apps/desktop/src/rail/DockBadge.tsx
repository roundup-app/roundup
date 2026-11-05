import { createEffect, createMemo } from "solid-js";
import type { Accessor } from "solid-js";
import type { RailNode } from "@contracts/agent/RailNode";
import type { App } from "../app/seam";
import { appSettings } from "../settings/preferences";
import { mayRaise, type ProjectAlerts } from "../state/projectAlerts";

/** U10, U182, U5232c, U6220d: the Dock badge counts the Agents whose Kind has `Dock badge` on (by default `needs-you` and `error`) in every open Project that is not narrowed past that Kind, and is cleared at zero. `onFailure` gets the message of a failed call. No UI of its own. */
export const DockBadge = (props: { app: Pick<App, "setDockBadge">; rails: Accessor<readonly { alerts: ProjectAlerts; nodes: readonly Partial<Pick<RailNode, "status" | "alert_level">>[] }[]>; onFailure: (message: string) => void }) => {
  const count = createMemo(() => {
    const chosen = appSettings().stateAlerts;

    return props.rails().reduce((sum, { alerts, nodes }) => sum + nodes.filter(node => node.alert_level !== "quiet" && node.status && node.status.kind !== "idle" && mayRaise(alerts, node.status.kind) && chosen[node.status.kind].badge).length, 0);
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
