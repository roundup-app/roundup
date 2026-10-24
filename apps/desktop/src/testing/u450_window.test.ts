import { expect, it } from "vitest";
import { RpcError } from "../app/seam";
import { createFakeApp } from "./fakeApp";

it("u450_fake_records_project_bound_window_title_writes", async () => {
  const app = createFakeApp();
  await app.forProject("/first").setWindowTitle("first");
  await app.forProject("/second").setWindowTitle("second");
  expect(app.windowOperations).toEqual([{ kind: "title", title: "first" }, { kind: "title", title: "second" }]);
});

it("u450_fake_rejects_title_writes", async () => {
  const app = createFakeApp();
  const error = new RpcError(-32603, "title refused");
  app.windowTitleHandler = async () => { throw error; };

  await expect(app.setWindowTitle("roundup")).rejects.toBe(error);
});

it("u450_fake_can_complete_pending_title_writes_in_reverse_order", async () => {
  const app = createFakeApp();
  const releases: (() => void)[] = [];
  const completed: string[] = [];
  app.windowTitleHandler = () => new Promise<void>((resolve) => { releases.push(resolve); });
  const old = app.setWindowTitle("old").then(() => { completed.push("old"); });
  const latest = app.setWindowTitle("latest").then(() => { completed.push("latest"); });
  expect(completed).toEqual([]);
  releases[1]!();
  await latest;
  expect(completed).toEqual(["latest"]);
  releases[0]!();
  await old;
  expect(completed).toEqual(["latest", "old"]);
});

it.each(["dragWindow", "zoomWindow"] as const)("u451_fake_records_%s_from_each_project", async (method) => {
  const app = createFakeApp();
  await app.forProject("/first")[method]();
  await app.forProject("/second")[method]();
  const kind = method === "dragWindow" ? "drag" : "zoom";
  expect(app.windowOperations).toEqual([{ kind }, { kind }]);
});

it("u451_served_window_operations_leave_the_browser_and_daemon_untouched", async () => {
  const { vi } = await import("vitest");
  const { createServedApp } = await import("./realSeam");
  const fetch = vi.fn(async () => ({ json: async () => ({ project: { name: "p", path: "/p" } }) }));
  vi.stubGlobal("fetch", fetch);
  const title = document.title;

  try {
    const app = createServedApp("http://isolated.test");

    await app.setWindowTitle("native title");
    await app.dragWindow();
    await app.zoomWindow();
    expect(document.title).toBe(title);
    expect(fetch.mock.calls).toHaveLength(1);
  } finally {
    vi.unstubAllGlobals();
  }
});

it("u450_project_bound_fake_controls_the_same_window_title_response", async () => {
  const app = createFakeApp();

  app.of("/first");
  const bound = app.of("/second");
  const error = new RpcError(-32603, "same native window");

  bound.windowTitleHandler = async () => { throw error; };

  await expect(app.setWindowTitle("roundup")).rejects.toBe(error);
});
