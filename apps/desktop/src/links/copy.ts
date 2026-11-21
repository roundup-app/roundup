import type { MadeItem } from "@contracts/links/MadeItem";
import { copy as sharedCopy } from "../sharedCopy";

const kindName = { pad: "Pad", todo: "Todo", file: "File" } as const;

/** LH21: a tooltip stays within five words: the kind word and the first four of the item's own name. */
const WORDS = 5;

/** LH7, LH10: the header's words; an entry's own tooltip comes from the side call. */
export const copy = {
  editor: sharedCopy.openInEditor,
  terminal: "Open Terminal here",
  expand: "Show links",
  collapse: "Hide links",
  moreName: (count: number) => `${count} more links`,
  lessName: "Show fewer links",
  less: "−",
  region: "Links",
  madeTooltip: (item: Pick<MadeItem, "kind" | "title">) => [`${kindName[item.kind]}:`, ...item.title.split(/\s+/).filter(Boolean)].slice(0, WORDS).join(" "),
};
