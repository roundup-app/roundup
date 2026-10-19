import { createSignal } from "solid-js";
import type { Accessor } from "solid-js";
import * as v from "valibot";
import type { App, DaemonExit, Project } from "../app/seam";
import { RpcError } from "../app/seam";
import { storedValue } from "./storage";

/** One open Project as the strip shows it: `generation` counts reopens, so a new Daemon's connection replaces the old one whole. */
export type OpenTab = {
  project: Project;
  /** Set once the Project's Daemon has ended; `reopenFailure` is why the last reopen failed and replaces the exit text until one succeeds. */
  exit: DaemonExit | null;
  reopenFailure: string | null;
  generation: number;
};

export type ProjectsState = {
  /** False until `projects` has answered. */
  loaded: Accessor<boolean>;
  /** The open Projects, in the order they were opened (U179). */
  tabs: Accessor<OpenTab[]>;
  /** The path of the Project on screen, or `null` with none open. */
  active: Accessor<string | null>;
  /** The last failure of a call the user made on the strip, or of `projects` itself; a success of the next call clears it. */
  failure: Accessor<string | null>;
  select(path: string): void;
  /** Asks the macOS chooser for a folder and opens it as a tab; a cancel changes nothing. */
  choose(): Promise<void>;
  /** Opens `path` as a tab as `choose` does, without the chooser; an Agent's `project_open` arrives here. */
  open(path: string): Promise<void>;
  /** Starts a new Daemon for an exited Project (U37); a failure keeps the exit and records why. */
  reopen(path: string): Promise<void>;
  /** True from a `reopen` call until it answers, so a second click cannot ask for a second Daemon. */
  reopening: Accessor<boolean>;
  /** Ends the Project's Daemon and drops its tab; the tab to its left opens (U184). */
  close(path: string): Promise<void>;
  /** Shows the latest submitted name; each reply keeps its original path, exact text and revision (U183, U2773b). */
  rename(path: string, name: string): Promise<{
    path: string;
    name: string;
    revision: number;
  } & ({ status: "acknowledged"; project: Project } | { status: "failed"; error: string } | { status: "unknown"; error: string })>;
};

/** The open tab's path, kept in the webview's saved state beside the Rail's layout (U186). */
const openTabStorage = () => storedValue("roundup:open-tab", v.string());

const folderOf = (path: string): string => path.split("/").filter(Boolean).at(-1) ?? path;

export const createProjectsState = (app: App, saved = openTabStorage()): ProjectsState => {
  const [loaded, setLoaded] = createSignal(false);
  const [tabs, setTabs] = createSignal<OpenTab[]>([]);
  const [active, setActive] = createSignal<string | null>(null);
  const [failure, setFailure] = createSignal<string | null>(null);
  const [reopening, setReopening] = createSignal(false);

  let renameRevision = 0;
  const renames = new Map<string, { committed: Project; acknowledged: number; pending: Map<number, string> }>();

  const update = (path: string, change: (tab: OpenTab) => OpenTab) => setTabs((all) => all.map((tab) => (tab.project.path === path ? change(tab) : tab)));

  const show = (path: string | null) => {
    setActive(path);

    if (path !== null) void saved.write(path);
  };

  void (async () => {
    try {
      const listed = await app.projects();

      setTabs(
        listed.map(({ name, path, running }) => ({ project: { name, path }, exit: running ? null : { code: null }, reopenFailure: null, generation: 0 })),
      );

      const last = saved.read();

      setActive(listed.some((entry) => entry.path === last) ? last : (listed.at(-1)?.path ?? null));
    } catch (error) {
      // The adapter rejects as an RpcError; a rejection that is not an Error is a bug and is rethrown, which surfaces as an unhandled rejection rather than as text.
      if (!(error instanceof Error)) throw error;

      setFailure(error.message);
    }

    setLoaded(true);
  })();

  void app.onDaemonExited((exit) => update(exit.path, (tab) => ({ ...tab, exit: { code: exit.code }, reopenFailure: null })));

  const openPath = async (path: string) => {
    const project = await app.openProject(path);
    const known = tabs().find((tab) => tab.project.path === project.path);

    setFailure(null);

    if (known) update(project.path, (tab) => ({ ...tab, project, exit: null, reopenFailure: null, generation: tab.exit ? tab.generation + 1 : tab.generation }));
    else setTabs((all) => [...all, { project, exit: null, reopenFailure: null, generation: 0 }]);

    show(project.path);
  };

  return {
    loaded,
    tabs,
    active,
    failure,
    reopening,
    select: (path) => {
      if (tabs().some((tab) => tab.project.path === path)) show(path);
    },
    choose: async () => {
      try {
        const path = await app.chooseProjectPath();

        if (path === null) return;

        await openPath(path);
      } catch (error) {
        // The adapter rejects as an RpcError; a rejection that is not an Error is a bug and is rethrown, which surfaces as an unhandled rejection rather than as text.
        if (!(error instanceof Error)) throw error;

        setFailure(error.message);
      }
    },
    open: async (path) => {
      try {
        await openPath(path);
      } catch (error) {
        if (!(error instanceof Error)) throw error;

        setFailure(error.message);
      }
    },
    reopen: async (path) => {
      if (reopening()) return;

      setReopening(true);

      try {
        const project = await app.openProject(path);

        update(path, (tab) => ({ project, exit: null, reopenFailure: null, generation: tab.generation + 1 }));
      } catch (error) {
        if (!(error instanceof Error)) throw error;

        update(path, (tab) => (tab.exit ? { ...tab, reopenFailure: error.message } : tab));
      } finally {
        setReopening(false);
      }
    },
    close: async (path) => {
      try {
        await app.closeProject(path);
      } catch (error) {
        // The adapter rejects as an RpcError; a rejection that is not an Error is a bug and is rethrown, which surfaces as an unhandled rejection rather than as text.
        if (!(error instanceof Error)) throw error;

        setFailure(error.message);

        return;
      }

      setFailure(null);

      const all = tabs();
      const at = all.findIndex((tab) => tab.project.path === path);
      const rest = all.filter((tab) => tab.project.path !== path);

      setTabs(rest);

      if (active() === path) {
        const next = rest[Math.max(at - 1, 0)];

        if (next) show(next.project.path);
        else setActive(null);
      }
    },
    rename: async (path, name) => {
      const submission = { path, name, revision: ++renameRevision };
      const before = tabs().find((tab) => tab.project.path === path)?.project;

      if (!before) return { ...submission, status: "failed", error: "Project is no longer open" };

      const holder = renames.get(path) ?? { committed: before, acknowledged: 0, pending: new Map<number, string>() };
      renames.set(path, holder);
      holder.pending.set(submission.revision, name.trim() || folderOf(path));

      const showName = () => {
        const latest = [...holder.pending].filter(([revision]) => revision > holder.acknowledged).at(-1);
        update(path, (tab) => ({ ...tab, project: latest ? { ...holder.committed, name: latest[1] } : holder.committed }));
      };

      showName();

      try {
        const project = await app.renameProject(path, name);

        holder.pending.delete(submission.revision);

        if (submission.revision > holder.acknowledged) {
          holder.committed = project;
          holder.acknowledged = submission.revision;
        }

        setFailure(null);
        showName();

        return { ...submission, status: "acknowledged", project };
      } catch (error) {
        if (!(error instanceof Error)) throw error;

        holder.pending.delete(submission.revision);
        setFailure(error.message);
        showName();

        // INTERNAL also covers a lost or malformed answer: only a domain refusal establishes rejection.
        if (error instanceof RpcError && (error.code === -32602 || error.code === -32003)) {
          return { ...submission, status: "failed", error: error.message };
        }

        try {
          const project = (await app.projects()).find((project) => project.path === path);

          if (project && submission.revision >= holder.acknowledged) {
            holder.committed = { path: project.path, name: project.name };
            showName();
          }
        } catch (readError) {
          if (!(readError instanceof Error)) throw readError;
          setFailure(`${error.message}; ${readError.message}`);
        }

        return { ...submission, status: "unknown", error: error.message };
      } finally {
        if (holder.pending.size === 0) renames.delete(path);
      }
    },
  };
};
