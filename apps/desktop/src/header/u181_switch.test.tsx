import { leaderKey } from "../keys/leaderFixture";
import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { agent } from "../testing/nodes";
import { openTabs, path, renderTabs, rowSelected, tab } from "./stripFixture";

afterEach(cleanup);

const names = () => [...document.querySelectorAll("[role=treeitem] .rail-name, [role=treeitem]")].map((row) => row.getAttribute("data-id"));

describe("u181 clicking a tab", () => {
  it("u181_switching_shows_the_other_projects_rail", async () => {
    await openTabs({ api: [agent("a-api", "idle", "x")], web: [agent("a-web", "idle", "x")] });

    expect(names()).toContain("a-web");

    fireEvent.click(tab("api"));

    await waitFor(() => expect(names()).toContain("a-api"));
    expect(names()).not.toContain("a-web");
    expect(tab("api").getAttribute("aria-selected")).toBe("true");
  });

  it("u181_each_project_keeps_its_own_selection", async () => {
    await openTabs({ api: [agent("a1", "idle", "x"), agent("a2", "idle", "x")], web: [agent("w1", "idle", "x")] });

    fireEvent.click(tab("api"));
    await waitFor(() => expect(names()).toContain("a1"));
    fireEvent.click(document.querySelector('[data-id="a2"]')!);
    fireEvent.click(tab("web"));
    await waitFor(() => expect(names()).toContain("w1"));
    fireEvent.click(tab("api"));

    await waitFor(() => expect(rowSelected("a2")).toBe("true"));
  });

  it("u181_a_click_on_the_open_tab_changes_nothing", async () => {
    const { app } = await openTabs({ api: [], web: [agent("w1", "idle", "x")] });
    const before = app.of(path("web")).calls.length;

    fireEvent.click(tab("web"));

    expect(tab("web").getAttribute("aria-selected")).toBe("true");
    expect(app.of(path("web")).calls.length).toBe(before);
  });

  it("u443_the_mark_keeps_its_rule_name_and_click", async () => {
    await openTabs({
      api: [agent("calm", "idle", "x"), agent("ask", "needs-you", "x"), agent("boom", "error", "x")],
      web: [agent("w1", "idle", "x")],
    });

    expect(tab("api").querySelector(".tab-mark")?.getAttribute("aria-label")).toBe("Error");
    fireEvent.click(tab("api").querySelector(".tab-mark")!);

    await waitFor(() => expect(rowSelected("boom")).toBe("true"));
    expect(tab("api").getAttribute("aria-selected")).toBe("true");
  });

  it("u181_no_call_goes_to_the_project_that_is_hidden_and_leader_j_uses_the_new_one", async () => {
    const { app } = await openTabs({ api: [agent("a1", "needs-you", "x")], web: [agent("w1", "needs-you", "x")] });

    fireEvent.click(tab("api"));
    await waitFor(() => expect(names()).toContain("a1"));

    const hidden = app.of(path("web")).calls.length;

    leaderKey("KeyJ");

    await waitFor(() => expect(rowSelected("a1")).toBe("true"));
    expect(app.of(path("web")).calls.length).toBe(hidden);
    expect(screen.queryByText("w1")).toBeNull();
  });

  it("u181_a_tab_is_busy_until_its_projects_rail_is_current", async () => {
    const { app } = renderTabs({ api: [], web: [] });
    let answer = () => {};

    const answered = new Promise<void>((done) => (answer = done));

    app.of(path("api")).handlers["rail.tree"] = async () => {
      await answered;

      return [agent("ask", "needs-you", "x")];
    };

    await waitFor(() => expect(tab("web").getAttribute("aria-busy")).toBe("false"));
    await waitFor(() => expect(app.of(path("api")).calls.some((call) => call.method === "rail.tree")).toBe(true));
    expect(tab("api").getAttribute("aria-busy")).toBe("true");
    expect(tab("api").querySelector(".tab-mark")).toBeNull();

    answer();

    await waitFor(() => expect(tab("api").getAttribute("aria-busy")).toBe("false"));
    expect(tab("api").querySelector(".tab-mark")?.getAttribute("data-kind")).toBe("needs-you");
  });

  it("u181_a_tab_whose_daemon_fails_to_connect_is_not_busy", async () => {
    const { app } = renderTabs({ api: [], web: [] });

    app.of(path("web")).subscribe = async () => {
      throw new Error("the Daemon's socket closed");
    };

    await waitFor(() => expect(tab("web").getAttribute("aria-busy")).toBe("false"));
    expect(app.of(path("web")).calls.some((call) => call.method === "rail.tree")).toBe(false);
  });
});
