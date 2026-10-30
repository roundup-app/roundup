import { expect, it } from "vitest";

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
