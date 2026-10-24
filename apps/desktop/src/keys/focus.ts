/** Appearance focus belongs to its requesting action, never to a later reply or mount.
 * Native focus events invalidate it permanently, including a trip away and back to the same element.
 * `choose` also invalidates older requests before an asynchronous destination has an element to focus.
 * Each permission is consumed once; refreshes cannot replay initial focus.
 */
const revisions = new WeakMap<Document, { value: number }>();

export const captureFocus = (choose = false): ((move: () => void) => boolean) => {
  let revision = revisions.get(document);

  if (!revision) {
    revision = { value: 0 };
    revisions.set(document, revision);
    const current = revision;

    document.addEventListener("focusin", () => { current.value++; }, true);
    document.addEventListener("pointerdown", () => { current.value++; }, true);
  }

  if (choose) revision.value++;
  const captured = revision.value;
  let used = false;

  return move => {
    if (used) return false;
    used = true;

    if (revision.value !== captured) return false;
    move();

    return true;
  };
};

/** A mount/return callback keeps the permission it had when queued. */
export const queueFocus = (move: () => void): void => {
  const focus = captureFocus();

  queueMicrotask(() => focus(move));
};
