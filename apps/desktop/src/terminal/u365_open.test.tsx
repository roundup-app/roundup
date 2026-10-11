import { cleanup, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { door, info, node, terminal } from "../testing/nodes";
import { mountPane } from "./paneHarness";

afterEach(cleanup);

const WORKTREE = { path: "/w/a", branch: "b", base: "main" };

describe("u365 a Terminal opens what it printed", () => {
  it("u365_a_web_link_opens_in_the_browser", async () => {
    const { app, connected, emulators } = await mountPane([terminal("a")], [info("t-a")]);

    connected.rail.select("a");
    emulators.get("t-a")!.openTarget({ kind: "url", url: "https://example.com" });

    await Promise.resolve();
    expect(app.opening.opened).toEqual([{ kind: "url", url: "https://example.com" }]);
  });

  it("u365_other_schemes_open_nothing", async () => {
    const { app, connected, emulators } = await mountPane([terminal("a")], [info("t-a")]);

    connected.rail.select("a");
    emulators.get("t-a")!.openTarget({ kind: "url", url: "file:///etc/passwd" });

    expect((await screen.findByRole("alert")).textContent).toContain("is not a web link");
    expect(app.opening.opened).toEqual([]);
  });

  it("u365_an_absolute_path_opens_with_its_line", async () => {
    const { app, connected, emulators } = await mountPane([terminal("a")], [info("t-a")]);

    connected.rail.select("a");
    emulators.get("t-a")!.openTarget({ kind: "path", path: "/abs/path/a.ts", line: 42, column: null });

    await Promise.resolve();
    expect(app.opening.opened).toEqual([{ kind: "path", path: "/abs/path/a.ts", line: 42 }]);
  });

  it("u365_a_relative_path_resolves_against_the_worktree", async () => {
    const { app, connected, emulators } = await mountPane([node("a", { worktree: WORKTREE })], [info("t-a")]);

    connected.rail.select("a");
    emulators.get("t-a")!.openTarget({ kind: "path", path: "src/a.ts", line: 42, column: null });

    await Promise.resolve();
    expect(app.opening.opened).toEqual([{ kind: "path", path: "/w/a/src/a.ts", line: 42 }]);
  });

  it("u365_without_a_worktree_it_resolves_against_the_project", async () => {
    const { app, connected, emulators } = await mountPane([node("a")], [info("t-a")]);

    connected.rail.select("a");
    emulators.get("t-a")!.openTarget({ kind: "path", path: "src/a.ts", line: null, column: null });

    await Promise.resolve();
    expect(app.opening.opened).toEqual([{ kind: "path", path: "/p/src/a.ts", line: null }]);
  });

  it("u365_a_missing_path_opens_nothing_and_says_so", async () => {
    const { app, connected, emulators } = await mountPane([node("a", { worktree: WORKTREE })], [info("t-a")]);

    app.opening.missing.add("/w/a/gone.ts");
    connected.rail.select("a");
    emulators.get("t-a")!.openTarget({ kind: "path", path: "gone.ts", line: 3, column: null });

    expect((await screen.findByRole("alert")).textContent).toBe("/w/a/gone.ts does not exist");
    expect(app.opening.opened).toEqual([]);

    emulators.get("t-a")!.openTarget({ kind: "path", path: "/abs/a.ts", line: null, column: null });
    await Promise.resolve();
    await Promise.resolve();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("u365_the_door_and_an_agent_share_one_handler", async () => {
    const { app, connected, emulators } = await mountPane([door("w", "working", "x"), node("a", { parent: "w", worktree: WORKTREE })], [info("t-w"), info("t-a")]);

    connected.rail.select("w");
    emulators.get("t-w")!.openTarget({ kind: "path", path: "src/a.ts", line: 1, column: null });
    connected.rail.select("a");
    emulators.get("t-a")!.openTarget({ kind: "path", path: "src/a.ts", line: 1, column: null });

    await Promise.resolve();
    expect(app.opening.opened).toEqual([
      { kind: "path", path: "/p/src/a.ts", line: 1 },
      { kind: "path", path: "/w/a/src/a.ts", line: 1 },
    ]);
  });
});
