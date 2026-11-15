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
  held: (name: string, holder: string) => `${name} is held by ${holder}.`,
  /** AI7152a, AI7152b: each Channel's name for a refusal's holder and the names it takes. */
  channels: {
    stable: { holder: "Stable", names: ["Roundup"] },
    dev: { holder: "Dev", names: ["Roundup Dev", "Dev"] },
    source: { holder: "Source", names: ["Roundup Source", "Source"] },
  },
  forkAt: (path: string) => `the Fork at ${path}`,
  list: "Forks",
  rename: sharedCopy.rename,
  recolour: "Recolour",
  renameField: (name: string) => `New name for ${name}`,
  recolourField: (name: string) => `New colour for ${name}`,
  collides: (holder: string) => `${holder} holds the same name or colour.`,
  invalidName: "Use 1 to 40 characters, with no control characters.",
};
