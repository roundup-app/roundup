import { copy as sharedCopy } from "../sharedCopy";

/** FS5979: the words of the Fork sheet. */
export const forkCopy = {
  name: sharedCopy.name,
  close: sharedCopy.close,
  title: "Fork for development",
  tree: sharedCopy.keep,
  colour: "Colour",
  make: "Make Fork",
  invalidName: "Use 1 to 40 characters, with no control characters.",
};
