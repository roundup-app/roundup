import { createSignal, onCleanup } from "solid-js";
import type { Accessor } from "solid-js";
import * as v from "valibot";
import { command } from "../app/command";
import type { App, DaemonExit, Project } from "../app/seam";
import { retryRead, RpcError } from "../app/seam";
import { captureFocus } from "../keys/focus";
import { modalOpen, questionPending } from "../keys/registry";
import { copy } from "./copy";
import { storageSchema, storedValue } from "./storage";

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
  /** The open Projects, in the order the user left them (U6220c); one not yet placed follows the placed ones, in the order it opened. */
  tabs: Accessor<OpenTab[]>;
  /** The path of the Project on screen, or `null` with none open. */
  active: Accessor<string | null>;
  /** Command and Project-list read failures recover independently. */
  failure: Accessor<string | null>;
  readFailure: Accessor<string | null>;
  reload(): Promise<void>;
  select(path: string): void;
  /** U6371a: takes the focus request a switch to `path` left, once; `move` runs only while the user has moved focus nowhere since the switch. */
  arrival(path: string): ((move: () => void) => boolean) | undefined;
  /** U6220c: puts the tabs in `paths` order, keeps that order for the next start, and leaves a tab `paths` omits after the rest. */
  reorder(paths: readonly string[]): void;
  /** Asks the macOS chooser for a folder and opens it as a tab; a cancel changes nothing. */
  choose(): Promise<void>;
  /** Opens `path` as a tab as `choose` does, without the chooser. */
  open(path: string): Promise<void>;
  /** Completes an Agent's authorized open, preserving failure identity for its caller. */
  openRequested(path: string): Promise<Project>;
  /** Finds a running Project by canonical identity without changing its tab or draft key. */
  opened(path: string): Promise<Project | undefined>;
  /** Starts a new Daemon for an exited Project (U37); a failure keeps the exit and records why. */
  reopen(path: string): Promise<void>;
  /** True from a `reopen` call until it answers, so a second click cannot ask for a second Daemon. */
  reopening: Accessor<boolean>;
  connected(path: string, generation: number): void;
  /** Ends the Project's Daemon and drops its tab; the tab to its left opens (U184). */
  close(path: string): Promise<void>;
  /** Last authoritative name for an open original, excluding pending optimistic names. */
  base(path: string): string | undefined;
  /** Shows the latest submitted name; each reply keeps its original path, exact text and revision (U183, U2773b). */
  rename(path: string, name: string, base?: string): Promise<{
    path: string;
    name: string;
    revision: number;
  } & ({ status: "acknowledged"; project: Project } | { status: "failed"; error: string } | { status: "unknown"; error: string })>;
};

/** The open tab's path, kept in the webview's saved state beside the Rail's layout (U186). */
const openTabSchema = storageSchema("roundup:open-tab", v.string());

const openTabStorage = () => storedValue("roundup:open-tab", openTabSchema);

/** The tab order, as the user left it, kept in the webview's saved state (U6220c). */
const tabOrderSchema = storageSchema("roundup:tab-order", v.array(v.string()));

const tabOrderStorage = () => storedValue("roundup:tab-order", tabOrderSchema);

/** `tabs` in `order`; a tab `order` omits keeps its relative place after the rest. */
const inOrder = (tabs: OpenTab[], order: readonly string[]): OpenTab[] => {
  const rank = (tab: OpenTab) => {
    const at = order.indexOf(tab.project.path);

    return at === -1 ? order.length : at;
  };

  return [...tabs].sort((a, b) => rank(a) - rank(b));
};

const folderOf = (path: string): string => path.split("/").filter(Boolean).at(-1) ?? path;

export const createProjectsState = (app: App, saved = openTabStorage(), order = tabOrderStorage()): ProjectsState => {
  const [loaded, setLoaded] = createSignal(false);
  const [tabs, setTabs] = createSignal<OpenTab[]>([]);
  const [active, setActive] = createSignal<string | null>(null);
  const [failure, setFailure] = createSignal<string | null>(null);
  const [readFailure, setReadFailure] = createSignal<string | null>(null);

  let renameRevision = 0;
  const renames = new Map<string, { committed: Project; acknowledged: number; remaining: number; pending: Map<number, string> }>();

  const update = (path: string, change: (tab: OpenTab) => OpenTab) => setTabs((all) => all.map((tab) => (tab.project.path === path ? change(tab) : tab)));

  let arriving: { path: string; focus: (move: () => void) => boolean } | null = null;

  const show = (path: string | null) => {
    // U6371b: only a change of Project asks for focus, and never from inside a dialog.
    if (path !== null && path !== active()) {
      arriving = questionPending() || modalOpen() ? null : { path, focus: captureFocus(true) };
    }

    setActive(path);

    if (path !== null) void saved.write(path);
  };

  const read = command(async () => {
    const listed = await retryRead(() => app.projects());

    setTabs(inOrder(
      listed.map(({ name, path, running }) => {
        const known = tabs().find(tab => tab.project.path === path);

        return known ?? { project: { name, path }, exit: running ? null : { code: null }, reopenFailure: null, generation: 0 };
      }),
      order.read() ?? [],
    ));

    const last = active() ?? saved.read();
    setReadFailure(null);

    setActive(listed.some((entry) => entry.path === last) ? last : (listed.at(-1)?.path ?? null));
  }, { fail: setReadFailure });

  const reload = async () => {
    if (read.state().kind === "pending") return;

    await read();
    setLoaded(true);
  };

  void reload();

  onCleanup(app.onDaemonExited(({ path, ...exit }) => update(path, (tab) => ({
    ...tab, exit, reopenFailure: null,
    generation: exit.recovery === "connecting" ? tab.generation + 1 : tab.generation,
  }))));

  const openPath = async (path: string) => {
    const project = await app.openProject(path);
    const known = tabs().find((tab) => tab.project.path === project.path);

    setFailure(null);

    if (known) update(project.path, (tab) => ({ ...tab, project, exit: null, reopenFailure: null, generation: tab.exit ? tab.generation + 1 : tab.generation }));
    else setTabs((all) => [...all, { project, exit: null, reopenFailure: null, generation: 0 }]);

    show(project.path);

    return project;
  };

  const opened = async (path: string): Promise<Project | undefined> => {
    const live = tabs().filter(tab => !tab.exit);
    const exact = live.find(tab => tab.project.path === path);

    if (exact) return exact.project;

    for (const tab of live) {
      if (await app.canonicalProjectPath(tab.project.path) === path) return tab.project;
    }

    return undefined;
  };

  const fail = setFailure;

  const choosing = command(async () => {
    const path = await app.chooseProjectPath();

    if (path !== null) await openPath(path);
  }, { fail });

  const opening = command(openPath, { fail });

  const openingRequested = command(openPath, { fail, rethrow: true });
  let reopenTarget = "";

  const reopenCall = command(async (path: string) => {
    const project = await app.openProject(path);

    update(path, (tab) => ({ project, exit: tab.exit, reopenFailure: null, generation: tab.generation + 1 }));
  }, { fail: (message) => update(reopenTarget, (tab) => (tab.exit ? { ...tab, reopenFailure: message } : tab)) });

  const renaming = command((path: string, name: string, base?: string) => app.renameProject(path, name, base), { fail });

  const reading = command(() => app.projects());

  const closing = command((path: string) => app.closeProject(path), { fail });

  const reopening = () => reopenCall.state().kind === "pending";

  return {
    opened,
    loaded,
    tabs,
    active,
    failure: () => readFailure() ?? failure(),
    readFailure,
    reload,
    reopening,
    connected: (path, generation) => update(path, tab => tab.generation === generation && tab.exit?.recovery !== "waiting" ? { ...tab, exit: null, reopenFailure: null } : tab),
    arrival: (path) => {
      if (arriving?.path !== path) return undefined;

      const { focus } = arriving;

      arriving = null;

      return focus;
    },
    select: (path) => {
      if (tabs().some((tab) => tab.project.path === path)) show(path);
    },
    reorder: (paths) => {
      const next = inOrder(tabs(), paths);

      setTabs(next);
      void order.write(next.map(tab => tab.project.path));
    },
    choose: async () => {
      await choosing();
    },
    openRequested: async (path) => {
      const known = await opened(path);

      if (known) return { ...known, path };

      const result = await openingRequested(path);

      // `rethrow` leaves only an applied call or a silent `AbortError`.
      if (result.kind !== "applied") throw result.error;

      return result.value;
    },
    open: async (path) => {
      await opening(path);
    },
    reopen: async (path) => {
      if (reopening()) return;

      reopenTarget = path;
      await reopenCall(path);
    },
    close: async (path) => {
      if ((await closing(path)).kind !== "applied") return;

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
    base: (path) => {
      const project = tabs().find(tab => tab.project.path === path)?.project;

      return project ? (renames.get(path)?.committed.name ?? project.name) : undefined;
    },
    rename: async (path, name, base) => {
      const submission = { path, name, revision: ++renameRevision };
      const before = tabs().find((tab) => tab.project.path === path)?.project;

      if (!before) return { ...submission, status: "failed", error: copy.projectNoLongerOpen };

      const holder = renames.get(path) ?? { committed: before, acknowledged: 0, remaining: 0, pending: new Map<number, string>() };
      renames.set(path, holder);
      holder.remaining++;
      holder.pending.set(submission.revision, name.trim() || folderOf(path));

      const showName = () => {
        const latest = [...holder.pending].filter(([revision]) => revision > holder.acknowledged).at(-1);
        update(path, (tab) => ({ ...tab, project: latest ? { ...holder.committed, name: latest[1] } : holder.committed }));
      };

      showName();

      const renamed = await renaming(path, name, base);

      try {
        if (renamed.kind === "applied") {
          const project = renamed.value;

          holder.pending.delete(submission.revision);

          if (submission.revision > holder.acknowledged) {
            holder.committed = project;
            holder.acknowledged = submission.revision;
          }

          setFailure(null);
          showName();

          return { ...submission, status: "acknowledged", project };
        }

        holder.pending.delete(submission.revision);
        showName();

        const { error } = renamed;

        // INTERNAL also covers a lost or malformed answer: only a domain refusal establishes rejection.
        if (renamed.kind === "failed" && error instanceof RpcError && error.code === -32602) {
          return { ...submission, status: "failed", error: error.message };
        }

        const listed = await reading();

        if (listed.kind === "applied") {
          const project = listed.value.find((project) => project.path === path);

          if (project && submission.revision >= holder.acknowledged) {
            holder.committed = { path: project.path, name: project.name };
            showName();
          }
        } else if (listed.kind === "failed") {
          setFailure(`${error.message}; ${listed.error.message}`);
        }

        return { ...submission, status: renamed.kind === "failed" ? renamed.outcome : "unknown", error: error.message };
      } finally {
        holder.remaining--;

        if (holder.remaining === 0) renames.delete(path);
      }
    },
  };
};
