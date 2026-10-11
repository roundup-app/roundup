import { createMemo } from "solid-js";
import type { Accessor } from "solid-js";
import type { Pad } from "@contracts/pad/Pad";
import { isOwnedOnRail, isPadOfRunning } from "../rail/pads/owned";
import type { PadList } from "../rail/pads/padList";
import type { ConnectedProject } from "../state/connectedProject";
import { useShelfScope } from "../todos/shelfScope";

/** U347: `this one` lists the Pads whose Home is the Workstream, an Agent's too; `all` is U58's list, where a Pad owned by an Agent on the Rail shows under that Agent instead. */
export const shownPads = (connected: ConnectedProject, list: PadList): Accessor<Pad[]> => {
  const scope = useShelfScope(connected);

  return createMemo(() => {
    const workstream = scope.workstream();

    if (workstream !== null && !scope.showAll()) return list.pads().filter((pad) => pad.home === workstream);

    // U347: with no Workstream selected, only what a running Agent (or a running Door) owns.
    if (workstream === null) return list.pads().filter((pad) => isPadOfRunning(pad, connected.rail.nodes));

    return list.pads().filter((pad) => !isOwnedOnRail(pad, connected.rail.nodes));
  });
};
