import { createSignal } from "solid-js";
import type { Accessor } from "solid-js";
import type { App, DaemonExit, Project } from "../app/seam";

type Phase =
  | { kind: "loading" }
  | { kind: "empty"; failure: string | null }
  | {
      kind: "open";
      project: Project;
      /** Set once the Daemon has ended; `reopenFailure` is why the last reopen failed and replaces the exit text until one succeeds. */
      daemonGone: { exit: DaemonExit; reopenFailure: string | null } | null;
      /** Counts reopens, so a new Daemon's connection replaces the old one whole. */
      generation: number;
    };

type ProjectState = {
  phase: Accessor<Phase>;
  /** Asks the macOS chooser for a folder and opens it as the Project; a cancel changes nothing. */
  choose(): Promise<void>;
  /** Starts a new Daemon for the open Project (U37); a failure keeps the exit and records why. */
  reopen(): Promise<void>;
  /** True from a `reopen` call until it answers, so a second click cannot ask for a second Daemon. */
  reopening: Accessor<boolean>;
};

export const createProjectState = (app: App): ProjectState => {
  const [phase, setPhase] = createSignal<Phase>({ kind: "loading" });
  const [reopening, setReopening] = createSignal(false);

  // The adapter rejects as an RpcError; a rejection that is not an Error is a bug and is rethrown, which surfaces as an unhandled rejection rather than as text.
  const fail = (failure: Error) => setPhase({ kind: "empty", failure: failure.message });

  const load = async () => {
    try {
      // One Project is shown until the strip lands (U179): the one opened last, which a launch with `roundup <project>` puts at the end.
      const listed = (await app.projects()).at(-1);

      setPhase(
        listed
          ? {
              kind: "open",
              project: { name: listed.name, path: listed.path },
              daemonGone: listed.running ? null : { exit: { code: null }, reopenFailure: null },
              generation: 0,
            }
          : { kind: "empty", failure: null },
      );
    } catch (failure) {
      if (!(failure instanceof Error)) throw failure;

      fail(failure);
    }
  };

  void load();

  void app.onDaemonExited((exit) => {
    const current = phase();

    if (current.kind === "open" && current.project.path === exit.path) setPhase({ ...current, daemonGone: { exit: { code: exit.code }, reopenFailure: null } });
  });

  return {
    phase,
    reopening,
    choose: async () => {
      try {
        const path = await app.chooseProjectPath();

        if (path === null) return;

        setPhase({ kind: "open", project: await app.openProject(path), daemonGone: null, generation: 0 });
      } catch (failure) {
        if (!(failure instanceof Error)) throw failure;

        fail(failure);
      }
    },
    reopen: async () => {
      const current = phase();

      if (current.kind !== "open" || reopening()) return;

      setReopening(true);

      try {
        const project = await app.openProject(current.project.path);

        setPhase({ kind: "open", project, daemonGone: null, generation: current.generation + 1 });
      } catch (failure) {
        if (!(failure instanceof Error)) throw failure;

        const latest = phase();

        if (latest.kind === "open" && latest.daemonGone) setPhase({ ...latest, daemonGone: { ...latest.daemonGone, reopenFailure: failure.message } });
      } finally {
        setReopening(false);
      }
    },
  };
};
