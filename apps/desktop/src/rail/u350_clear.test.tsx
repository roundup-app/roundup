import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RpcError } from "../app/seam";
import { agent, door, event } from "../testing/nodes";
import { mountRail, railCallsTo, rowOf } from "./railFixture";

const NOT_ACKED = -32008;

const tree = () => [door("w", "idle", "idle", { name: "ws" }), agent("a", "working", "x", { parent: "w" })];

/** The Rail with the Workstream selected, as the Door's own Terminal now is (U467), its clear answered `{pending: true}`. */
const mountSelected = async () => {
  const mounted = await mountRail(tree());

  mounted.app.handlers["workstream.clear"] = () => ({ pending: true });
  mounted.rail.select("w");

  return mounted;
};

const openMenu = (name: string) => fireEvent.contextMenu(rowOf(name), { clientX: 10, clientY: 10 });

const open = async (app: { pickMenu: (label: string) => Promise<void> }) => {
  openMenu("ws");
  await app.pickMenu("Clear…");
};

const reasonField = () => screen.getByRole<HTMLTextAreaElement>("textbox", { name: /Why clear/ });

const type = (text: string) => fireEvent.input(reasonField(), { target: { value: text } });

const clearButton = () => screen.getByRole<HTMLButtonElement>("button", { name: "Clear and keep a summary" });

// jsdom has no layout observer; U427's Chromium tests assert prompt placement and resizing.
beforeEach(() => vi.stubGlobal("ResizeObserver", class {
  observe() {}
  disconnect() {}
}));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("u350 the user clears a Workstream from the Rail", () => {
  it("u350_clear_is_disabled_without_a_reason", async () => {
    const { app } = await mountSelected();
    await open(app);
    await waitFor(() => expect(document.activeElement).toBe(reasonField()));

    expect(document.body.textContent).toContain("and stops 1 Subagent; their files stay");
    expect(clearButton().disabled).toBe(true);

    type("   ");

    expect(clearButton().disabled).toBe(true);

    type("too much");

    expect(clearButton().disabled).toBe(false);
  });

  it("u350_one_call_with_the_trimmed_reason", async () => {
    const { app } = await mountSelected();

    await open(app);
    type("  too much  ");
    fireEvent.submit(reasonField().closest("form")!);
    await waitFor(() => expect(railCallsTo(app, "workstream.clear")).toHaveLength(1));

    expect(railCallsTo(app, "workstream.clear")).toEqual([{ id: "w", reason: "too much" }]);
  });

  it("u350_keep_and_esc_call_nothing", async () => {
    const { app } = await mountSelected();

    await open(app);
    type("x");
    fireEvent.click(screen.getByRole("button", { name: "Keep" }));

    expect(screen.queryByRole("textbox", { name: /Why clear/ })).toBeNull();

    await open(app);
    fireEvent.keyDown(reasonField(), { key: "Escape" });

    expect(screen.queryByRole("textbox", { name: /Why clear/ })).toBeNull();
    expect(railCallsTo(app, "workstream.clear")).toEqual([]);
  });

  it("u350_pending_removes_nothing_and_hides_the_menu_item", async () => {
    const { app } = await mountSelected();

    await open(app);
    openMenu("ws");
    expect(app.menuLabels()).not.toContain("Clear…");
    await app.closeMenu();
    type("why");
    fireEvent.click(clearButton());
    await waitFor(() => expect(document.body.textContent).toContain("The supervisor is writing the summary"));

    expect(reasonField().disabled).toBe(true);
    expect(clearButton().disabled).toBe(true);
    expect(document.querySelector('[role=treeitem][data-id="a"]')).not.toBeNull();
    expect(railCallsTo(app, "workstream.clear")).toHaveLength(1);

    openMenu("ws");

    expect(app.menuLabels()).not.toContain("Clear…");

    app.emit(event({ name: "workstream.cleared", data: { id: "w", iteration: 2 } }));

    await waitFor(() => expect(screen.queryByRole("textbox", { name: /Why clear/ })).toBeNull());
  });

  it("u350_a_missing_handoff_offers_clear_without_handoff", async () => {
    const { app } = await mountSelected();

    await open(app);
    type("why");
    fireEvent.click(clearButton());
    await waitFor(() => expect(railCallsTo(app, "workstream.clear")).toHaveLength(1));
    app.emit(event({ name: "workstream.clearFailed", data: { id: "w", code: NOT_ACKED, message: "no Handoff from w in time" } }));

    await screen.findByText("no Handoff from w in time");

    expect(reasonField().value).toBe("why");
    fireEvent.click(screen.getByRole("button", { name: "Clear without a summary" }));
    await waitFor(() => expect(railCallsTo(app, "workstream.clear")).toHaveLength(2));

    expect(railCallsTo(app, "workstream.clear")[1]).toEqual({ id: "w", reason: "why", without_handoff: true });
  });

  it("u350_a_conflict_shows_its_message_and_no_second_word", async () => {
    const { app } = await mountSelected();

    app.handlers["workstream.clear"] = () => { throw new RpcError(-32003, "the Door is not running"); };

    await open(app);
    type("why");
    fireEvent.click(clearButton());
    await screen.findByText("the Door is not running");

    expect(screen.queryByRole("button", { name: "Clear without a summary" })).toBeNull();
  });

  it("u350_no_clear_item_on_a_subagent", async () => {
    const { app } = await mountSelected();

    openMenu("a");

    expect(app.menuLabels()).not.toContain("Clear…");
  });
});
