import { copy as sharedCopy } from "../sharedCopy";

/** LH7, LH10: the header's words; an entry's own tooltip comes from the side call. */
export const copy = {
  editor: sharedCopy.openInEditor,
  terminal: sharedCopy.newTerminal,
  expand: "Show links",
  collapse: "Hide links",
  moreName: (count: number) => `${count} more links`,
  lessName: "Show fewer links",
  region: "Links",
};
