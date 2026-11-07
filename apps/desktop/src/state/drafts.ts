import { createStore, unwrap } from "solid-js/store";

/** One reactive holder for a Project's drafts and its retention problem. Records are replaced, never mutated, so readers share the raw values `unwrap` returns. */
export const createDraftsStore = <D extends object, P extends object>() => {
  const [state, setState] = createStore<{ drafts: D[]; problem: P | null }>({ drafts: [], problem: null });

  return {
    state,
    /** Untracked-safe raw records for the holder's own logic. */
    current: (): D[] => unwrap(state.drafts),
    setDrafts: (next: D[]) => setState({ drafts: next }),
    setProblem: (next: P | null) => setState({ problem: next }),
    problem: (): P | null => unwrap(state.problem),
    list: (keep: (draft: D) => boolean = () => true): D[] => state.drafts.filter(keep).map(draft => unwrap(draft)),
  };
};
