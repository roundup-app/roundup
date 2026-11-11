import { cleanup, fireEvent, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { openTabs, path } from "../header/stripFixture";
import { agent, event } from "../testing/nodes";
import type { FakeApp } from "../testing/fakeApp";

afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); vi.useRealTimers(); });

beforeEach(() => {
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(60_000);
});

const ready = (app: FakeApp) => app.menuBar?.entries.filter(entry => entry.action?.kind === "agent") ?? [];

it("u3566_the_menu_focus_state_survives_a_click", async () => {
  const { app } = await openTabs({ api: [agent("a", "working", "running")] });
  await waitFor(() => expect(document.querySelector('[role=treeitem][data-id="a"]')).not.toBeNull());
  const row = document.querySelector<HTMLElement>('[role=treeitem][data-id="a"]');

  if (!row) throw new Error("no row a");
  fireEvent.click(row);
  fireEvent.blur(window);
  app.of(path("api")).emit(event({ name: "agent.status", data: { id: "a", attempt: "1", status_revision: "2", status: { kind: "idle", label: "settled", since: 10, finished: "1" } } }));
  await waitFor(() => expect(ready(app)).toHaveLength(1));

  vi.spyOn(app, "showWindow").mockImplementation(async () => { fireEvent.focus(window); });
  app.menuBarAction({ kind: "open" });
  await waitFor(() => expect(app.showWindow).toHaveBeenCalled());
  fireEvent.pointerDown(document.body);
  fireEvent.focus(window);
  expect(ready(app)).toHaveLength(1);

  fireEvent.click(document.body);
  await waitFor(() => expect(ready(app)).toHaveLength(0));
});
