import { createMemo } from "solid-js";
import type { Accessor } from "solid-js";
import type { Pad } from "@contracts/pad/Pad";

import type { PadList } from "../rail/pads/padList";
import type { ConnectedProject } from "../state/connectedProject";
import { shelfScope } from "../shelf/scope";

/** U2744a: Pads follow the same Rail-derived scope as Todos. */
export const shownPads = (connected: ConnectedProject, list: PadList): Accessor<Pad[]> => {
  const scope = shelfScope(connected);

  return createMemo(() => list.pads().filter(pad => scope.includes(pad.home, pad.owner)));
};
