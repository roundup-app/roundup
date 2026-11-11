import { copy as sharedCopy } from "../sharedCopy";

export const copy = {
  todos: sharedCopy.todos,
  pads: sharedCopy.pads,
  exitedBySignal: sharedCopy.exitedBySignal,
  leaderShortShelf: sharedCopy.leaderShortShelf,
  padBody: sharedCopy.padBody,
  rail: sharedCopy.rail,
  retryDoor: sharedCopy.retryDoor,
  startDoor: sharedCopy.startDoor,
  modePrompt: sharedCopy.modePrompt,
  modePromptMenu: sharedCopy.modePromptMenu,
  comma: sharedCopy.comma,
} as const;
