/** U5240b: the mounted Shelf lists register how they open a Todo or Pad through its Rail row; the Switcher asks here, and opens the Drawer itself when no list is mounted. */
type Opener = (key: number | string) => boolean;

const openers = new Set<{ kind: "todo" | "pad"; open: Opener }>();

/** A Shelf list registers its opener; it returns false for a key the list does not hold. The returned function unregisters it. */
export const registerOpener = (kind: "todo" | "pad", open: Opener): (() => void) => {
  const entry = { kind, open };

  openers.add(entry);

  return () => { openers.delete(entry); };
};

/** True when a mounted list opened the item through its row. */
export const openThroughRow = (kind: "todo" | "pad", key: number | string): boolean => [...openers].some(entry => entry.kind === kind && entry.open(key));
