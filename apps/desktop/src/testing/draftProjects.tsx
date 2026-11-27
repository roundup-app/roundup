import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createComponent, useContext } from "solid-js";
import { expect } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { RequestedApp as App } from "./requestedApp";
import { fakeEmulators } from "../terminal/paneHarness";
import { createFakeApp } from "./fakeApp";
import { info, terminal } from "./nodes";
import { ProjectDraftsContext, useConnectedProject, type createProjectDrafts, type ConnectedProject } from "../state/connectedProject";

/** Two real temporary Projects behind the whole App, on the fake Daemon seam. */
export const openDraftProjects = async () => {
  const directory = mkdtempSync(join(tmpdir(), "roundup-drafts-"));
  const paths = [join(directory, "a"), join(directory, "b")];
  const app = createFakeApp();
  const seen: ConnectedProject[] = [];
  let authority: ReturnType<typeof createProjectDrafts> | null | undefined;

  const emulators = fakeEmulators();

  for (const [index, path] of paths.entries()) {
    mkdirSync(path);
    app.add(path);
    app.of(path).handlers["rail.tree"] = () => [terminal(`editor-${index}`)];
    app.of(path).handlers["terminal.list"] = () => [info(`t-editor-${index}`)];
  }

  const view = render(() => createComponent(App, {
    app, reducedMotion: () => false, clock: () => 0,
    createEmulator: (id) => {
      // A component reads the Project authority at render, where an owner holds the context; the App provides it once, above the header and every Pane.
      authority ??= useContext(ProjectDraftsContext);
      seen.push(useConnectedProject());

      return emulators.factory(id);
    },
  }));

  // U7155a: a Project's Pane stays mounted across switches, so its newest connection is the one the last Terminal created for it saw.
  const connection = (index: number) => seen.filter((open) => open.project.path === paths[index]).at(-1);

  const select = async (index: number) => {
    const tabs = within(await screen.findByRole("tablist", { name: "Projects" })).getAllByRole("tab");
    const tab = tabs[index];

    if (!tab) throw new Error(`no Project tab ${index}`);
    fireEvent.click(tab);
    fireEvent.click(await waitFor(() => within(screen.getByRole("tree", { name: "Rail" })).getByText(`editor-${index}`)));
    await waitFor(() => expect(connection(index)).toBeDefined());
    const opened = connection(index);

    if (!opened) throw new Error(`Project ${index} did not connect`);

    return opened;
  };

  return { app, paths, select, connection, authority: () => authority, close: () => { view.unmount(); rmSync(directory, { recursive: true, force: true }); } };
};
