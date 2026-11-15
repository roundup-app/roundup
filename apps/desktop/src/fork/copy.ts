import { copy as sharedCopy } from "../sharedCopy";

/** FS5979: the words of the Fork sheet. */
export const forkCopy = {
  name: sharedCopy.name,
  close: sharedCopy.close,
  title: "Fork for development",
  tree: sharedCopy.keep,
  colour: "Colour",
  make: "Make Fork",
  colourTaken: "Every colour is in use. Recolour or delete a Fork to free one.",
  claimedBy: (name: string, holder: string) => `${name} is held by ${holder}.`,
  channelStable: "Roundup",
  channelDev: "Roundup Dev",
  channelSource: "Roundup Source",
  forkAt: (path: string) => `Fork at ${path}`,
  list: "Forks",
  rename: sharedCopy.rename,
  recolour: "Recolour",
  renameField: (name: string) => `Rename ${name}`,
  recolourField: (name: string) => `Recolour ${name}`,
  collides: (holder: string) => `${holder} holds the same name or colour.`,
  invalidName: "Use 1 to 40 characters, with no control characters.",
};
