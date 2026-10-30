import type { JSX } from "solid-js";
import type * as Solid from "solid-js";
import type { LinkContent } from "@contracts/link/LinkContent";
import { RpcError, type App, type NativeOpen } from "./seam";
import type { ProjectsState } from "../state/projects";
import type { ConnectedProject } from "../state/connectedProject";
import { REVEAL_BUBBLE } from "../bubbles/places";
import { linkCopy } from "./copy";

/** Native open requests stay out of the startup entry; App loads this once mounted, under its own owner, and routes each request to the returned handler. */
export const watchNativeOpen = ({ solid: { createEffect, createSignal, onCleanup }, app, projects, connectionOf, item, fail }: {
  solid: Pick<typeof Solid, "createEffect" | "createSignal" | "onCleanup">;
  app: App;
  projects: ProjectsState;
  connectionOf: (path: string) => ConnectedProject | undefined;
  /** The Drawer body for a linked Pad or Todo; its Drawers stay in the entry that already holds them. */
  item: (content: LinkContent, fail: (message: string) => void) => JSX.Element;
  fail: (message: string | null) => void;
}) => {
  const [linked, setLinked] = createSignal<{ path: string; content: LinkContent } | null>(null);
  createEffect(() => {
    const target = linked();
    const open = target && connectionOf(target.path);

    if (!target || !open) return;
    const content = target.content;
    projects.select(target.path);
    open.settingsView.close();

    if (content.kind === "agent" || content.kind === "workstream") open.rail.select(content.id);
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

  return (request: NativeOpen) => {
    pending = pending.then(async () => {
      if (stopped) return;

      if (request.kind === "project") {
        await projects.open(request.path);

        return;
      }
      // Only link.read parses and authorizes the URL. A foreign Project cannot resolve
      // a same-named object; unopened Projects are never discovered from filesystem names.

      const listed = await app.projects();
      const failures: string[] = [];

      for (const project of listed.filter(project => project.running)) {
        try {
          const content = await app.forProject(project.path).rpc("link.read", { url: request.url });

          if (content.kind === "deliverable") throw new Error(linkCopy.published);
          setLinked({ path: project.path, content });
          fail(null);

          return;
        } catch (error) {
          if (!(error instanceof Error)) throw error;

          // Only the link's own Project names its cause; every other Project answers that it is not theirs.
          if (error instanceof RpcError && error.data?.kind === "other-project") continue;

          failures.push(error.message);
        }
      }

      // A link no Project can parse fails the same way in each; name that cause once.
      fail([...new Set(failures)].join("; ") || linkCopy.projectClosed);
    }).catch(error => { if (!(error instanceof Error)) throw error; fail(error.message); });
  };
};
