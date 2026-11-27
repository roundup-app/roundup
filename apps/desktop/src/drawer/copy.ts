import { copy as sharedCopy, clockTime } from "../sharedCopy";

export { clockTime };

const touch = (name: string, verb: string, time: string) => `${name} ${verb} · ${time}`;

export const copy = {
  tryAgain: sharedCopy.retryStorage,
  pads: sharedCopy.pads,
  close: sharedCopy.close,
  drawer: sharedCopy.drawer,
  lastTouch: touch,
  padTouch: touch,
  maximise: sharedCopy.maximise,
  restore: sharedCopy.restore,
  you: sharedCopy.you,
} as const;
