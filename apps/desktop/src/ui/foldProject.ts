type Start = (scope: Element, change: () => void, anchor?: Element) => void;

let active: Start | null = null;

/** Called by the fold helper once it runs; returns the call that detaches it. Kept apart from `fold.ts` so Motion stays out of the entry bundle (R3800). */
export const attachFold = (start: Start): (() => void) => {
  active = start;

  return () => { if (active === start) active = null; };
};

/** A fold that is not a click on a fold control (the Rail drag's lift fold, U6550a): `change` sets the final layout once and the rows below project from where they were drawn through the shared fold helper (U6398a). With no helper running it only changes. */
export const projectFold = (scope: Element, change: () => void, anchor?: Element): void => {
  if (active) active(scope, change, anchor);
  else change();
};
