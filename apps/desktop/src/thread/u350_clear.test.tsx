import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { RpcError } from "../app/seam";
import { agent, door, event } from "../testing/nodes";
import { message, mountThread } from "./threadFixture";

const NOT_ACKED = -32008;

const tree = () => [door("w", "idle", "idle", { name: "ws" }), agent("a", "working", "x", { parent: "w" })];

const clears = (app: { calls: { method: string; params: unknown }[] }) => app.calls.filter((call) => call.method === "workstream.clear");

const open = () => fireEvent.click(screen.getByRole("button", { name: "clear…" }));

const reasonField = () => screen.getByRole<HTMLInputElement>("textbox", { name: /why clear/ });

const type = (text: string) => fireEvent.input(reasonField(), { target: { value: text } });

afterEach(cleanup);

describe("u350 the user clears a Workstream from its Thread", () => {
  it("u350_clear_is_disabled_without_a_reason", async () => {
    await mountThread(tree());
    open();
    await waitFor(() => expect(document.activeElement).toBe(reasonField()));

    expect(document.body.textContent).toContain("stops 1 Subagents; their files stay");
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "clear" }).disabled).toBe(true);

    type("   ");

    expect(screen.getByRole<HTMLButtonElement>("button", { name: "clear" }).disabled).toBe(true);

    type("too much");

    expect(screen.getByRole<HTMLButtonElement>("button", { name: "clear" }).disabled).toBe(false);
  });

  it("u350_one_call_with_the_trimmed_reason", async () => {
    const { app } = await mountThread(tree(), { prepare: (fake) => { fake.handlers["workstream.clear"] = () => ({ pending: true }); } });

    open();
    type("  too much  ");
    fireEvent.submit(reasonField().closest("form")!);
    await waitFor(() => expect(clears(app)).toHaveLength(1));

    expect(clears(app)[0]!.params).toEqual({ id: "w", reason: "too much" });
  });

  it("u350_keep_and_esc_call_nothing", async () => {
    const { app } = await mountThread(tree());

    open();
    type("x");
    fireEvent.click(screen.getByRole("button", { name: "keep" }));

    expect(screen.queryByRole("textbox", { name: /why clear/ })).toBeNull();

    open();
    fireEvent.keyDown(reasonField(), { key: "Escape" });

    expect(screen.queryByRole("textbox", { name: /why clear/ })).toBeNull();
    expect(clears(app)).toHaveLength(0);
  });

  it("u350_pending_removes_nothing", async () => {
    const { app } = await mountThread(tree(), { prepare: (fake) => { fake.handlers["workstream.clear"] = () => ({ pending: true }); } });

    open();
    type("why");
    fireEvent.click(screen.getByRole("button", { name: "clear" }));
    await waitFor(() => expect(document.body.textContent).toContain("the Door is writing the handoff"));

    expect(reasonField().disabled).toBe(true);
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "clear" }).disabled).toBe(true);
    expect(document.querySelector('[role=treeitem][data-id="a"]')).not.toBeNull();
    expect(clears(app)).toHaveLength(1);

    app.emit(event({ name: "workstream.cleared", data: { id: "w", iteration: 2 } }));

    await waitFor(() => expect(screen.queryByRole("textbox", { name: /why clear/ })).toBeNull());
  });

  it("u350_a_missing_handoff_offers_clear_without_handoff", async () => {
    const { app } = await mountThread(tree(), { prepare: (fake) => { fake.handlers["workstream.clear"] = () => ({ pending: true }); } });

    open();
    type("why");
    fireEvent.click(screen.getByRole("button", { name: "clear" }));
    await waitFor(() => expect(clears(app)).toHaveLength(1));
    app.emit(event({ name: "workstream.clearFailed", data: { id: "w", code: NOT_ACKED, message: "no Handoff from w in time" } }));

    await screen.findByText("no Handoff from w in time");

    expect(reasonField().value).toBe("why");
    fireEvent.click(screen.getByRole("button", { name: "clear without handoff" }));
    await waitFor(() => expect(clears(app)).toHaveLength(2));

    expect(clears(app)[1]!.params).toEqual({ id: "w", reason: "why", without_handoff: true });
  });

  it("u350_a_conflict_shows_its_message_and_no_second_word", async () => {
    await mountThread(tree(), { prepare: (fake) => { fake.handlers["workstream.clear"] = () => { throw new RpcError(-32003, "the Door is not running"); }; } });

    open();
    type("why");
    fireEvent.click(screen.getByRole("button", { name: "clear" }));
    await screen.findByText("the Door is not running");

    expect(screen.queryByRole("button", { name: "clear without handoff" })).toBeNull();
  });

  it("u350_the_old_thread_stays_above_the_new_one", async () => {
    await mountThread(tree(), {
      messages: [
        message(1, { from: { kind: "agent", id: "w", parent: null }, to: "you", body: "old words", iteration: 1 }),
        message(2, { from: { kind: "agent", id: "w", parent: null }, to: "you", body: "new words", iteration: 2 }),
      ],
    });

    const rule = document.querySelector("[data-iteration-rule]")!;
    const old = document.querySelector('[data-message="1"]')!;
    const fresh = document.querySelector('[data-message="2"]')!;

    expect(rule.textContent).toBe("iteration 2");
    expect(old.compareDocumentPosition(rule) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(rule.compareDocumentPosition(fresh) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("u350_a_long_reason_is_cut_to_one_line", async () => {
    const { app } = await mountThread(tree(), {
      messages: [
        message(1, { from: { kind: "agent", id: "w", parent: null }, to: "you", iteration: 1 }),
        message(2, { from: { kind: "agent", id: "w", parent: null }, to: "you", iteration: 2 }),
      ],
      prepare: (fake) => { fake.handlers["workstream.clear"] = () => ({ pending: true }); },
    });

    open();
    type("because ".repeat(60).trim());
    fireEvent.click(screen.getByRole("button", { name: "clear" }));
    await waitFor(() => expect(clears(app)).toHaveLength(1));
    app.emit(event({ name: "workstream.cleared", data: { id: "w", iteration: 2 } }));

    await waitFor(() => expect(document.querySelector("[data-iteration-rule]")?.textContent).toContain("iteration 2 · cleared: because"));

    expect(document.querySelector("[data-iteration-rule]")!.textContent).toBe(`iteration 2 · cleared: ${"because ".repeat(60).trim()}`);
    expect(getComputedStyle(document.querySelector("[data-iteration-rule]")!).textOverflow).toBe("ellipsis");
  });

  it("u350_no_clear_word_on_a_subagent", async () => {
    const { connected } = await mountThread(tree());

    connected.rail.select("a");

    expect(screen.queryByRole("button", { name: "clear…" })).toBeNull();
  });

  it("u350_the_row_menu_has_the_same_word", async () => {
    await mountThread(tree());

    fireEvent.contextMenu(document.querySelector('[role=treeitem][data-id="w"]')!);
    fireEvent.click(screen.getByRole("menuitem", { name: "clear…" }));

    expect(reasonField()).toBeTruthy();
  });
});
