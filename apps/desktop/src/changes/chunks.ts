/** The Worktree panel's two heavy chunks (startup budget R3800). `settled` resolves once every load started so far has ended, so a test can wait before its environment goes. */
const pending = new Set<Promise<unknown>>();

const track = <T>(load: Promise<T>): Promise<T> => {
  pending.add(load);
  void load.then(() => pending.delete(load), () => pending.delete(load));

  return load;
};

export const loadReader = () => track(import("./DiffReader"));

export const loadTree = () => track(import("./ChangedTree"));

export const settled = async (): Promise<void> => { await Promise.allSettled(pending); };
