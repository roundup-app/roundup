/** The Changes view's diff chunk (startup budget R3800). `settled` resolves once every load started so far has ended, so a test can wait before its environment goes. */
const pending = new Set<Promise<unknown>>();

const track = <T>(load: Promise<T>): Promise<T> => {
  pending.add(load);
  void load.then(() => pending.delete(load), () => pending.delete(load));

  return load;
};

export const loadReader = () => track(import("./ModuleScroll"));

export const settled = async (): Promise<void> => { await Promise.allSettled(pending); };
