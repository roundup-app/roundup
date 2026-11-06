import type { JSX } from "solid-js";
import type * as Solid from "solid-js";
import type { LinkContent } from "@contracts/link/LinkContent";
import { linkCopy } from "./copy";
import { RpcError, type App, type NativeOpen } from "./seam";
import type { ProjectsState } from "../state/projects";
import type { ConnectedProject } from "../state/connectedProject";
import { REVEAL_BUBBLE } from "../bubbles/places";
import { captureFocus } from "../keys/focus";
import { inProject, keyOfPath } from "./linkRoute";

/** An OS request, or a `roundup://` link clicked in a surface of the Project at `surface` (U6249c1). */
export type OpenRequest = Extract<NativeOpen, { kind: "project" }> | { kind: "link"; url: string; surface?: string | undefined };

const INVALID_PARAMS = -32602;

/** Native open requests stay out of the startup entry; App loads this once mounted, under its own owner, and routes each request to the returned handler. */
export const watchNativeOpen = ({ solid: { createEffect, createSignal, onCleanup }, app, projects, connectionOf, item, fail }: {
  solid: Pick<typeof Solid, "createEffect" | "createSignal" | "onCleanup">;
  app: App;
  projects: ProjectsState;
  connectionOf: (path: string) => ConnectedProject | undefined;
  /** The Drawer body for a linked Pad or Todo; its Drawers stay in the entry that already holds them. */
  item: (content: LinkContent, fail: (message: string) => void) => JSX.Element;
  /** An `action` is the one thing the user can do about the failure; the App shows it beside a dismissal. */
  fail: (message: string | null, action?: { label: string; run: () => void }) => void;
}) => {
  const [linked, setLinked] = createSignal<{ path: string; content: LinkContent; focus: ReturnType<typeof captureFocus> } | null>(null);
  createEffect(() => {
    const target = linked();
    const open = target && connectionOf(target.path);

    if (!target || !open) return;
    const content = target.content;

    // Selecting another destination would remove the newer input even without moving focus.
    if ((content.kind === "agent" || content.kind === "workstream") && target.focus.signal().aborted) {
      setLinked(null);

      return;
    }

    projects.select(target.path);
    open.settingsView.close(false);

    if (content.kind === "deliverable") {
      open.rail.select(null);
      open.showView("made");
      open.selectMade(content.record.id);
    } else if (content.kind === "agent" || content.kind === "workstream") open.rail.select(content.id, "open", target.focus);
    else if (content.kind === "terminal") {
      const owner = open.rail.nodes.find(node => node.terminal_id === content.id)?.id
        ?? open.rail.terminals().find(terminal => terminal.id === content.id)?.owner;

      open.rail.select(owner === target.path ? null : owner ?? null);
      // The active Project mounts its existing Bubble listener after selection.
      queueMicrotask(() => window.dispatchEvent(new CustomEvent(REVEAL_BUBBLE, { detail: content.id })));
    } else if (content.kind === "pad" || content.kind === "todo") {
      open.drawer.open(() => item(content, fail), "key", { kind: content.kind, project: target.path });
    }

    setLinked(null);
  });

  let stopped = false;
  let pending = Promise.resolve();
  onCleanup(() => { stopped = true; });

  /** U6249c3: the recent Project, not open, whose key the link names. */
  const closedProject = async (url: string) => {
    const key = URL.canParse(url) ? new URL(url).searchParams.get("project") : null;

    if (key === null) return undefined;

    for (const path of await app.recentProjects()) {
      if (await keyOfPath(path) === key) return { path, name: path.split("/").findLast(Boolean) ?? path };
    }

    return undefined;
  };

  const open = (request: OpenRequest, offer = true) => {
    const focus = captureFocus(true);
    pending = pending.then(async () => {
      if (stopped) return;

      if (request.kind === "project") {
        await projects.open(request.path);

        return;
      }
      // Only link.read parses and authorizes the URL. A foreign Project cannot resolve
      // a same-named object; unopened Projects are never discovered from filesystem names.

      const surface = request.surface;
      const url = surface === undefined ? request.url : await inProject(app.forProject(surface), request.url);

      // The surface's own Project answers first, so a project-less link is read once, by its owner.
      const running = (await app.projects()).filter(project => project.running)
        .sort((a, b) => Number(b.path === surface) - Number(a.path === surface));

      const failures: string[] = [];

      for (const project of running) {
        try {
          const content = await app.forProject(project.path).rpc("link.read", { url });

          setLinked({ path: project.path, content, focus });
          fail(null);

          return;
        } catch (error) {
          if (!(error instanceof Error)) throw error;

          // Only the link's own Project names its cause; every other Project answers that it is not theirs.
          if (error instanceof RpcError && error.data?.kind === "other-project") continue;

          // U6249c3: the user cannot fix a link no Project can parse; the App log holds the cause.
          if (error instanceof RpcError && error.code === INVALID_PARAMS) {
            console.warn(linkCopy.notOpened(url, error.message));

            return;
          }

          failures.push(error.message);
        }
      }

      if (failures.length === 0) {
        const closed = offer ? await closedProject(url) : undefined;

        if (!closed) console.warn(linkCopy.notOpened(url, linkCopy.noOwner));
        else fail(linkCopy.closed(closed.name), { label: linkCopy.openProject(closed.name), run: () => void projects.open(closed.path).then(() => { fail(null); open(request, false); }) });
      } else fail([...new Set(failures)].join("; "));
    }).catch(error => { if (!(error instanceof Error)) throw error; fail(error.message); });
  };

  // Native anchors use the same authorization and destination route as an OS link.
  const activate = (event: MouseEvent) => {
    const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[data-native-link]") : null;

    if (!anchor || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    open({ kind: "link", url: anchor.href, surface: anchor.dataset.nativeLink });
  };

  document.addEventListener("click", activate, true);
  onCleanup(() => document.removeEventListener("click", activate, true));

  return open;
};
