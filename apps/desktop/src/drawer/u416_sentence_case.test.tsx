import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { node } from "../testing/nodes";
import { createFakeApp } from "../testing/fakeApp";
import { ConnectedProjectContext, connectProject } from "../state/connectedProject";
import { ItemDrawer } from "./ItemDrawer";
import { createDrawer } from "./drawer";
import { DrawerHost } from "./DrawerHost";

afterEach(cleanup);

it("u416_drawer_frame_uses_sentence_case", () => {
  const drawer = createDrawer();
  render(() => <DrawerHost drawer={drawer} reducedMotion={() => true} />);
  drawer.open(() => <p>workstream</p>);

  expect(screen.getByRole("complementary", { name: "Drawer" }).textContent).toContain("workstream");
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(drawer.content()).toBeNull();
});

it("u416_drawer_last_touch_uses_sentence_case_and_preserves_agent_names", async () => {
  const app = createFakeApp();
  app.handlers["rail.tree"] = () => [node("agent-id", { name: "workstream" })];
  app.handlers["provenance.history"] = () => [{
    actor: { kind: "agent", id: "agent-id", parent: null },
    verb: "wrote",
    item: "todo:3",
    at: new Date(2026, 0, 5, 14, 2).getTime(),
  }];
  const connected = await connectProject(app, { name: "p", path: "/p" }, () => false, () => 0);
  render(() => (
    <ConnectedProjectContext.Provider value={connected}>
      <ItemDrawer item="todo:3" read={async () => "authored text"}>
        {(text) => <p>{text}</p>}
      </ItemDrawer>
    </ConnectedProjectContext.Provider>
  ));

  expect(await screen.findByText("Last workstream wrote 14:02")).toBeTruthy();
});

it.each([
  ["user", "you", /^You wrote this Pad at /],
  ["agent", "agent-id", /^workstream wrote this Pad at /],
] as const)("u416_drawer_pad_touch_keeps_glossary_case_for_%s", async (kind, id, expected) => {
  const app = createFakeApp();
  app.handlers["rail.tree"] = () => [node("agent-id", { name: "workstream" })];
  app.handlers["provenance.history"] = () => [{
    actor: { kind, id, parent: null },
    verb: "wrote",
    item: "pad:notes",
    at: new Date(2026, 0, 5, 14, 2).getTime(),
  }];
  const connected = await connectProject(app, { name: "p", path: "/p" }, () => false, () => 0);
  render(() => (
    <ConnectedProjectContext.Provider value={connected}>
      <ItemDrawer item="pad:notes" sentence read={async () => "workstream"}>
        {(text) => <p>{text}</p>}
      </ItemDrawer>
    </ConnectedProjectContext.Provider>
  ));

  expect(await screen.findByText(expected)).toBeTruthy();
});
