import { cleanup, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { createFakeApp } from "./fakeApp";
import { node, workstream, event } from "./nodes";
import { connectProject, ConnectedProjectContext } from "../state/connectedProject";
import { Tabs } from "../ui/Tabs";
import { createShelfFrame } from "../shelf/frame";
import { Shelf, createShelfTabs } from "../shelf/Shelf";

afterEach(cleanup);

it("u2744a_shelf_scope_no_scope_button", async () => {
  const app = createFakeApp();
  const tree = [workstream("w"), node("a", { parent: "w" }), node("r")];
  app.handlers["rail.tree"] = () => tree;
  const connected = await connectProject(app, { name: "p", path: "/p" }, () => true, () => 0);
  await connected.rail.settled();
  render(() => {
    const frame = createShelfFrame(() => null, () => true, () => {});
    const tabs = createShelfTabs(frame);

    return <ConnectedProjectContext.Provider value={connected}><Tabs.RootProvider value={tabs}><Shelf open={() => true} /></Tabs.RootProvider></ConnectedProjectContext.Provider>;
  });

  for (const selected of [null, "w", "a", "r"]) {
    connected.rail.select(selected);
    expect(document.querySelector(".scope-control")).toBeNull();
    expect(screen.queryByRole("button", { name: /Show (all|only)/ })).toBeNull();

    if (selected) expect(document.querySelector("[data-shelf-scope] .shelf-scope-name")?.textContent).toBe(tree.find(node => node.id === selected)?.name);
  }

  tree[2] = { ...tree[2]!, name: "renamed root" };
  app.emit(event({ name: "rail.changed" }));
  await waitFor(() => expect(document.querySelector("[data-shelf-scope] .shelf-scope-name")?.textContent).toBe("renamed root"));
});
