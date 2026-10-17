import { leaderKey } from "../keys/leaderFixture";
import { cleanup, render, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../App";
import { agent } from "../testing/nodes";
import { fakeEmulators } from "../terminal/paneHarness";
import { openTabs, path, rowSelected, tab, projectTabs } from "./stripFixture";

afterEach(cleanup);

const open = () => projectTabs().find((entry) => entry.getAttribute("aria-selected") === "true")?.textContent?.replace(/[⊗◉]/, "");

describe("u186 keys", () => {
  it("u186_leader_shift_j_goes_to_the_next_marked_project_and_selects_its_most_urgent_agent", async () => {
    await openTabs({
      api: [agent("a1", "needs-you", "x"), agent("a2", "error", "x")],
      web: [],
      docs: [agent("d1", "needs-you", "x")],
    });

    leaderKey("KeyJ", { shiftKey: true });
    await waitFor(() => expect(open()).toBe("api"));
    await waitFor(() => expect(rowSelected("a2")).toBe("true"));

    leaderKey("KeyJ", { shiftKey: true });
    await waitFor(() => expect(open()).toBe("docs"));
  });

  it("u186_with_one_marked_project_it_acts_as_leader_j_and_with_none_changes_nothing", async () => {
    await openTabs({ api: [agent("a", "idle", "x")], web: [agent("w1", "needs-you", "x")] });

    leaderKey("KeyJ", { shiftKey: true });
    await waitFor(() => expect(rowSelected("w1")).toBe("true"));
    expect(open()).toBe("web");

    cleanup();
    await openTabs({ api: [agent("a", "idle", "x")], web: [agent("w", "idle", "x")] });

    leaderKey("KeyJ", { shiftKey: true });

    expect(open()).toBe("web");
  });

  it("u186_a_restart_shows_the_stored_order_and_names_and_the_open_tab_again", async () => {
    const { app } = await openTabs({ api: [], web: [], docs: [] });

    await app.renameProject(path("web"), "payments");
    tab("api").click();
    await waitFor(() => expect(open()).toBe("api"));
    cleanup();

    render(() => <App app={app} reducedMotion={() => false} clock={() => 0} createEmulator={fakeEmulators().factory} />);

    await waitFor(() => expect(projectTabs().map((entry) => entry.textContent)).toEqual(["api", "payments", "docs"]));
    expect(open()).toBe("api");
  });

  it("u186_a_stored_tab_that_is_no_longer_open_is_treated_as_absent", async () => {
    window.localStorage.setItem("roundup:open-tab", JSON.stringify("/gone"));
    const { app } = await openTabs({ api: [], web: [] });

    window.localStorage.setItem("roundup:open-tab", JSON.stringify("/gone"));
    cleanup();
    render(() => <App app={app} reducedMotion={() => false} clock={() => 0} createEmulator={fakeEmulators().factory} />);

    await waitFor(() => expect(projectTabs()).toHaveLength(2));
    expect(projectTabs().filter((entry) => entry.getAttribute("aria-selected") === "true")).toHaveLength(1);
  });
});
