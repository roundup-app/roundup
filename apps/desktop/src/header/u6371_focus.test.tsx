import { leaderKey } from "../keys/leaderFixture";
import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { agent } from "../testing/nodes";
import { questionDialog } from "../shelf/bulkQuestionHarness";
import { openTabs, path, renderTabs, projectTabs, tab } from "./stripFixture";

beforeEach(() => { vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(20); });

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const pick = async (id: string) => {
  fireEvent.click(await waitFor(() => {
    const row = document.querySelector<HTMLElement>(`[role=treeitem][data-id="${id}"]`);

    if (!row) throw new Error(`no row ${id}`);

    return row;
  }));
};

const inEmulator = (terminal: string) => expect(document.activeElement).toBe(document.querySelector(`[data-terminal="${terminal}"]`));

const twoProjects = async () => {
  const opened = await openTabs({ api: [agent("a1", "needs-you", "x")], web: [agent("w1", "idle", "x")] });

  await pick("w1");
  fireEvent.click(tab("api"));
  await pick("a1");
  fireEvent.click(tab("web"));
  await waitFor(() => inEmulator("t-w1"));
  // SAFETY: inEmulator just held, so the focused element is the emulator's div.
  (document.activeElement as HTMLElement).blur();

  return opened;
};

const ways: [string, () => void | Promise<void>][] = [
  ["a click on a tab", () => userEvent.click(tab("api"))],
  ["Enter on a focused tab", async () => { tab("api").focus(); await userEvent.keyboard("{Enter}"); }],
  ["Space on a focused tab", async () => { tab("api").focus(); await userEvent.keyboard(" "); }],
  ["a click on a Tab mark", () => userEvent.click(tab("api").querySelector(".tab-mark")!)],
  ["the leader jump", () => { leaderKey("KeyJ", { shiftKey: true }); }],
  ["the Project picker", async () => {
    leaderKey("KeyP");
    fireEvent.click(await screen.findByRole("option", { name: /api/ }));
  }],
  ["closing the open tab", () => { fireEvent.click(screen.getByLabelText("Close web")); }],
];

describe("u6371 a switch puts focus in the centre", () => {
  it.each(ways)("u6371a_every_way_to_switch_focuses_the_new_centre: %s", async (_name, way) => {
    await twoProjects();
    await way();

    await waitFor(() => expect(tab("api").getAttribute("aria-selected")).toBe("true"));
    await waitFor(() => inEmulator("t-a1"));
  });

  it("u6371a_every_way_to_switch_focuses_the_new_centre: a Project with no Terminal gets its first control", async () => {
    await openTabs({ api: [], web: [agent("w1", "idle", "x")] });
    fireEvent.click(tab("api"));

    await waitFor(() => expect(document.activeElement?.closest(".pane-screen, .centre-frame")).not.toBeNull());
    expect(document.activeElement).not.toBe(tab("api"));
  });

  it("u6371b_a_non_switch_or_an_earlier_focus_move_keeps_focus", async () => {
    const { app } = await openTabs({ api: [agent("a1", "working", "x")], web: [agent("w1", "idle", "x")] });
    const shown = app.of(path("web")).calls.length;

    await userEvent.click(tab("web"));
    await userEvent.keyboard("{ArrowLeft}");
    expect(tab("web").getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement?.closest("[role=tablist]")).not.toBeNull();
    expect(app.of(path("web")).calls.length).toBe(shown);

    await userEvent.click(tab("web"));
    expect(document.activeElement).toBe(tab("web"));

    // The close-Project question is open: a switch leaves focus where it is.
    fireEvent.click(screen.getByLabelText("Close api"));
    await questionDialog();
    await userEvent.click(tab("api"));
    await waitFor(() => expect(tab("api").getAttribute("aria-selected")).toBe("true"));
    await Promise.resolve();
    expect(document.activeElement).toBe(tab("api"));
  });

  it("u6371b_a_focus_move_before_a_slow_projects_rail_answers_survives_its_arrival", async () => {
    const { app } = renderTabs({ api: [], web: [agent("w1", "idle", "x")] });

    let answer = () => {};

    const answered = new Promise<void>(done => (answer = done));

    app.of(path("api")).handlers["rail.tree"] = async () => {
      await answered;

      return [agent("a1", "idle", "x")];
    };

    await waitFor(() => expect(tab("web").getAttribute("aria-busy")).toBe("false"));
    await userEvent.click(tab("api"));
    await waitFor(() => expect(tab("api").getAttribute("aria-selected")).toBe("true"));

    tab("web").focus();
    answer();
    await waitFor(() => expect(projectTabs().map(each => each.getAttribute("aria-busy"))).toEqual(["false", "false"]));
    await waitFor(() => expect(document.querySelector('[role=treeitem][data-id="a1"]')).not.toBeNull());
    await Promise.resolve();
    expect(document.activeElement).toBe(tab("web"));
  });
});
