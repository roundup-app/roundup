/** App-authored timeline copy (U471). Supplied values remain unchanged. */
import { copy as shared } from "../sharedCopy";

export const copy = {

  timeline: shared.timeline,
  timelineLanes: shared.settingsAgents,
  timelineNow: shared.timelineNow,

  timelineOpenTerminal: shared.openEvidence,
  timelineTrack: (name: string) => `${name}: last 30m`,
  timelineAgo: (minutes: number) => `${minutes}m ago`,
  timelineUnknown: shared.timelineUnknown,
  /** @prose */
  timelineEmpty: "No Agent activity has appeared yet.",
  timelineRemoved: (name: string) => `${name} (removed)`,
  timelineStarted: (parent: string, child: string) => `${parent} started ${child}`,
} as const;
