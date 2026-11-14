import type { MenuEntry } from "../../ui/contextMenu";

/** A menu item and the condition under which a row offers it; an item without `when` is always offered. */
export type Candidate = MenuEntry & { when?: boolean };

/** The items whose condition holds, in the order given. */
export const offered = (candidates: readonly Candidate[]): MenuEntry[] =>
  candidates.flatMap(({ when, ...entry }) => (when === false ? [] : [entry]));
