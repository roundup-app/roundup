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
  taken: (name: string, holder: string) => `${name} is taken by ${holder}.`,
  channelStable: "Roundup",
  channelDev: "Roundup Dev",
  channelSource: "Roundup Source",
  shortDev: "Dev",
  shortSource: sharedCopy.draftField("source"),
  forkAt: (path: string) => `Fork at ${path}`,
  list: "Forks",
  rename: sharedCopy.rename,
  recolour: "Recolour",
  collides: (holder: string) => `${holder} holds the same name or colour.`,
  invalidName: "Use 1 to 40 characters, with no control characters.",
};
