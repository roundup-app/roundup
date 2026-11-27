import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, expect, it, vi } from "vitest";
import { notices } from "../testing/notices";
import { connectProject, ConnectedProjectContext } from "../state/connectedProject";
import { createFakeApp } from "../testing/fakeApp";
import { ItemDrawer } from "./ItemDrawer";
import { ToastHost } from "../testing/toastHost";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it.each(["history", "read", "render"].flatMap(failure => ["retry", "switch"].map(action => ({ failure, action }))))("p3557c_failure_lifetime_item_drawer_$failure_$action", async ({ failure, action }) => {
  localStorage.clear();
  let fixed = false;
  const app = createFakeApp();
  app.handlers["provenance.history"] = () => {
    if (failure === "history") throw new Error("opening refused");

    return [];
  };

  const connected = await connectProject(app, { name: "p", path: "/p" }, () => true, () => 0);
  const draft = connected.drafts.edit({ surface: "orders", object: "other", recipient: "b" }, { ask: "  unfinished é\n雪  " }, null, "ordinary").draft;
  const [item, setItem] = createSignal("original");
  render(() => <ToastHost><ConnectedProjectContext value={connected}>
    <ItemDrawer item={item()} read={async () => {
      if (item() === "original" && failure === "read" && !fixed) throw new Error("opening refused");

      return item();
    }}>
      {value => {
        if (value === "original" && failure === "render" && !fixed) throw new Error("opening refused");

        return <p>{value}</p>;
      }}
    </ItemDrawer>
  </ConnectedProjectContext></ToastHost>);
  await screen.findByText("opening refused");

  if (action === "retry") {
    fixed = true;
    app.handlers["provenance.history"] = () => [];
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByText("original");
    expect(notices("alert")).toEqual([]);
  } else {
    app.handlers["provenance.history"] = () => [];
    setItem("next item");
    await screen.findByText("next item");
    expect(notices("alert")).toEqual([]);
  }

  expect(connected.drafts.list()).toEqual([draft]);
});
