import { createContext, createSignal, onCleanup, untrack, useContext } from "solid-js";
import type { Accessor } from "solid-js";
import type { App, AppSettingsPage, UpdateFacts } from "../app/seam";

/** U7208: the two programs an update row names. */
export const PROGRAMS = ["roundup", "core"] as const;

export type Program = (typeof PROGRAMS)[number];

/** The page `show` asks for. */
type ShownPage = NonNullable<AppSettingsPage>;

export type Updates = {
  /** What the App last said, `null` until it first answers. */
  facts: Accessor<UpdateFacts | null>;
  /** U7208b, U7208c: the program's update is running; its button is disabled. */
  running(program: Program): boolean;
  /** The one-line cause of the program's last failed update, until the next attempt or Dismiss. */
  failure(program: Program): string | null;
  dismiss(program: Program): void;
  /** Runs the program's update: roundup installs and relaunches, herdr-core runs `herdr-core update` and shows the version it left. */
  update(program: Program): Promise<void>;
  /** U7208e: asks Settings to show its Updates page. */
  show(): void;
  /** What shows the page: Settings listens, and is told which page. */
  onShow(listener: (page: ShownPage) => void): () => void;
};

/** U7208d: the facts the App holds, at launch and after each hourly look. */
export const createUpdates = (app: App): Updates => {
  const [facts, setFacts] = createSignal<UpdateFacts | null>(null);
  const [running, setRunning] = createSignal<ReadonlySet<Program>>(new Set());

  const [failures, setFailures] = createSignal<
    Partial<Record<Program, string>>
  >({});

  // An hourly look that lands first outranks the answer to the launch read.
  let heard = false;

  untrack(() => {
    onCleanup(app.onUpdatesChanged(next => { heard = true; setFacts(next); }));
    void app.updates().then(next => { if (!heard) setFacts(next); });
  });

  const shows = new Set<(page: ShownPage) => void>();

  const clear = (program: Program) =>
    setFailures(({ [program]: _gone, ...rest }) => rest);

  return {
    facts,
    running: (program) => running().has(program),
    failure: (program) => failures()[program] ?? null,
    dismiss: clear,
    show: () => shows.forEach((listener) => listener("updates")),
    onShow: (listener) => {
      shows.add(listener);

      return () => shows.delete(listener);
    },
    update: async (program) => {
      if (running().has(program)) return;

      clear(program);
      setRunning((previous) => new Set(previous).add(program));

      try {
        if (program === "roundup") await app.installUpdate();
        else setFacts(await app.updateCore());
      } catch (cause) {
        if (!(cause instanceof Error)) throw cause;

        setFailures((previous) => ({ ...previous, [program]: cause.message }));
      } finally {
        setRunning(
          (previous) => new Set([...previous].filter((item) => item !== program)),
        );
      }
    },
  };
};

/** What Settings shows when nothing provides the facts: no rows. */
const unknown: Updates = { facts: () => null, running: () => false, failure: () => null, dismiss: () => {}, update: async () => {}, show: () => {}, onShow: () => () => {} };

const UpdatesContext = createContext<Updates>(unknown);

export const UpdatesProvider = UpdatesContext.Provider;

export const useUpdates = (): Updates => useContext(UpdatesContext);
