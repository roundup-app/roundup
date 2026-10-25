type CopyValue = string | number | undefined;

import { copy as shared } from "../sharedCopy";

/** App-authored copy owned by this surface (U471). */
export const copy = {
  timeline: shared.timeline,
  timelineStarted: (parent: string, child: string) => `${parent} started ${child}`,
  timelineEmpty: "No Agent activity seen yet",
  timelineNow: shared.timelineNow,
  timelineAgo: (minutes: number) => `${minutes}m ago`,
  timelineLanes: shared.settingsAgents,
  timelineRemoved: (name: string) => `${name} (removed)`,
  timelineTrack: (name: string) => `${name} over the last 30 minutes`,
  timelineUnknown: "Unknown",
  timelineOpenTerminal: (value1: CopyValue) => `Open ${value1}`,
} as const;
