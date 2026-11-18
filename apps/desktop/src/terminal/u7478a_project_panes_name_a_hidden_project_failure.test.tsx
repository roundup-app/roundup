import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { createSignal, flush, useContext } from "solid-js";
import { afterEach, expect, it } from "vitest";
import { RpcError } from "../app/seam";
import { ToastQueueContext } from "../ink/messageToast";
import { info, terminal } from "../testing/nodes";
import { notices } from "../testing/notices";
import { ToastHost } from "../testing/toastHost";
import { connectFakeProject, fakeEmulators } from "./paneHarness";
import { createProjectPanes } from "./ProjectPanes";

afterEach(cleanup);

it("u7478a_project_panes_name_a_hidden_project_failure", async () => {
  const notes = await connectFakeProject([terminal("a")], [info("t-a")], 0, () => null, { name: "notes-app", path: "/notes" });
  const meta = await connectFakeProject([terminal("a")], [info("t-a")], 0, () => null, { name: "meta-harness", path: "/meta" });
  const connections = new Map([["/notes", notes.connected], ["/meta", meta.connected]]);
  const [active, setActive] = createSignal<string | null>("/notes");

  const Panes = () => {
    const toasts = useContext(ToastQueueContext);

    if (!toasts) throw new Error("ToastHost provides the queue");

    const panes = createProjectPanes({
      active,
      toasts,
      connectionOf: path => connections.get(path),
      createEmulator: () => fakeEmulators().factory,
      observeTerminal: () => {},
      arrival: () => undefined,
      focusPane: () => {},
      notice: () => null,
      openObject: () => {},
      over: () => null,
      header: () => null,
    });

    return <>{panes.view()}</>;
  };

  render(() => <ToastHost><Panes /></ToastHost>);
  flush();

  // Each Project is shown once, so both keep their Pane; notes-app is shown again.
  setActive("/meta");
  flush();
  setActive("/notes");
  flush();

  // A failed Rail read is the Pane's notice (`createProjectPanes` passes `rail.failure`), so the Pane view itself raises the toast.
  const fail = async (project: typeof notes, message: string) => {
    project.app.handlers["rail.tree"] = () => {
      throw new RpcError(-32603, message);
    };

    await project.connected.rail.refresh({ terminals: true });
    flush();
  };

  await fail(meta, "meta tree unreadable");
  expect(notices("alert")).toHaveLength(1);
  screen.getByRole("alert", { name: /^meta-harness · .*meta tree unreadable/ });
  fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
  flush();
  expect(notices("alert")).toHaveLength(0);

  await fail(notes, "notes tree unreadable");
  expect(notices("alert")).toHaveLength(1);
  screen.getByRole("alert", { name: /^(?!.* · ).*notes tree unreadable/ });
});
