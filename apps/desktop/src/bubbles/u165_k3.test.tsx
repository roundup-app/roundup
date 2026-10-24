import { cleanup, render, waitFor } from "@solidjs/testing-library";
import { createSignal, Show } from "solid-js";
import type { RailNode } from "@contracts/agent/RailNode";
import type { TerminalInfo } from "@contracts/terminal/TerminalInfo";
import { createFakeApp } from "../testing/fakeApp";
import { event, info, workstream } from "../testing/nodes";
import { connectProject, ConnectedProjectContext } from "../state/connectedProject";
import { createKeystrokeRun } from "../perf/run";
import { Rail } from "../rail/Rail";
import { Pane } from "../terminal/Pane";
import { fakeEmulators } from "../terminal/paneHarness";
import type { Screens } from "../terminal/screens";
import { afterEach, describe, expect, it } from "vitest";
import { Bubbles } from "./Bubbles";

afterEach(cleanup);

describe("u165 K3 opens its terminal with the key", () => {
  it("u165_k3_opens_its_terminal_with_cmd_t_after_new_workstream", async () => {
    const app = createFakeApp();
    const tree: RailNode[] = [];
    let listed: TerminalInfo[] = [];
    let agentShown = false;
    let openedAfterAgent: boolean | null = null;

    app.handlers["rail.tree"] = () => structuredClone(tree);
    app.handlers["terminal.list"] = () => listed;
    app.handlers["terminal.write"] = () => null;
    app.handlers["terminal.resize"] = () => null;
    app.handlers["terminal.snapshot"] = () => ({ cols: 100, rows: 30, after: 0, data: "" });
    app.handlers["rail.startDoor"] = () => workstream("made");
    app.handlers["rail.createWorkstream"] = () => {
      const made = workstream("made");

      tree.push(made);
      queueMicrotask(() => app.emit(event({ name: "rail.changed" })));
      // The Workstream's Agent Terminal shows after its row: its focus would fold a bubble opened before it.
      setTimeout(() => {
        agentShown = true;
        document.body.append(Object.assign(document.createElement("textarea"), { className: "xterm-helper-textarea" }));
      }, 50);

      return made;
    };

    app.handlers["terminal.open"] = ({ workstream: owner }) => {
      openedAfterAgent = agentShown;
      listed = [info("9", { owner, title: "sh" })];
      queueMicrotask(() => app.emit(event({ name: "terminal.changed" })));

      return { terminal_id: "9" };
    };

    const connected = await connectProject(app, { name: "p", path: "/p" }, () => false, () => 0, () => null);
    const emulators = fakeEmulators();

    render(() => {
      const [screens, setScreens] = createSignal<Screens>();

      return (
        <ConnectedProjectContext.Provider value={connected}>
          <Rail />
          <div class="centre-stack">
            <Pane createEmulator={emulators.factory} screensRef={setScreens} />
            <Show when={screens()}>{(shared) => <Bubbles screens={shared()} />}</Show>
          </div>
        </ConnectedProjectContext.Provider>
      );
    });

    // The run's emulators are real xterm ones, which jsdom cannot host: the run ends on its own bound, after the open.
    void createKeystrokeRun(app).start();

    await waitFor(() => expect(app.calls.filter((call) => call.method === "terminal.open").map((call) => call.params)).toEqual([{ workstream: "made" }]));

    const methods = app.calls.map((call) => call.method);

    expect(methods.indexOf("rail.createWorkstream")).toBeLessThan(methods.indexOf("terminal.open"));
    expect(methods.filter((method) => method === "rail.createWorkstream")).toHaveLength(1);
    expect(openedAfterAgent).toBe(true);
    expect(document.querySelector('[role="treeitem"]')).not.toBeNull();
  });
});
