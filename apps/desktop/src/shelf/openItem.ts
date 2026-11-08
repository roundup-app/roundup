/** U5240b: the mounted Shelf lists register how they open a Todo or Pad through its Rail row; the Switcher asks here, and opens the Drawer itself when no list is mounted. */
type Opener = (key: number | string) => boolean;

const selectedRows = new Set<{ kind: "todo" | "pad"; key: () => number | string | undefined }>();

const openers = new Set<{ kind: "todo" | "pad"; open: Opener }>();

/** A Shelf list registers its opener, and with `selected` (U3721a) says which row is its focused or first selected one; it returns false for a key the list does not hold. The returned function unregisters it. */
export const registerOpener = (kind: "todo" | "pad", open: Opener, selected?: () => number | string | undefined): (() => void) => {
  const entry = { kind, open };
  const row = selected && { kind, key: selected };

  openers.add(entry);

  if (row) selectedRows.add(row);

  return () => {
    openers.delete(entry);

    if (row) selectedRows.delete(row);
  };
};

/** U3721a: open the mounted list's selected row in the Drawer through its own opener; false when no row is selected. */
export const openSelectedRow = (): boolean => [...selectedRows].some((entry) => {
  const key = entry.key();

  return key !== undefined && openThroughRow(entry.kind, key);
});

/** True when a mounted list opened the item through its row. */
export const openThroughRow = (kind: "todo" | "pad", key: number | string): boolean => [...openers].some(entry => entry.kind === kind && entry.open(key));
