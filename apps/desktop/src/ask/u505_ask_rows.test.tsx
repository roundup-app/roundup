import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { event } from "../testing/nodes";
import { ask, mountAskBar, press, rowTexts } from "./askFixture";

afterEach(cleanup);

const typed = ask("a1", 2, [{ text: "ship it", placement: { kind: "routed", workstream: "ops" }, state: "typed" }]);

describe("u505 an Ask row shows progress from Agent state", () => {
  it("u505_a_row_follows_the_doors_status", async () => {
    const { app } = await mountAskBar([
      ask("a0", 1, [{ text: "later", placement: { kind: "routed", workstream: "lead" }, state: "queued" }]),
      typed,
    ]);

    await waitFor(() => expect(rowTexts()).toEqual(["ship it | ops | SentNeeds-you", "later | lead | Queued for the supervisor"]));

    app.emit(event({ name: "ask.changed", data: { ask: ask("a0", 1, [{ text: "later", placement: { kind: "routed", workstream: "lead" }, state: "typed" }]) } }));
    await waitFor(() => expect(rowTexts()[1]).toBe("later | lead | SentIdle"));
    app.emit(event({ name: "agent.status", data: { id: "lead", attempt: "1", status_revision: "2", status: { kind: "working", label: "working", since: 2 } } }));
    await waitFor(() => expect(rowTexts()[1]).toBe("later | lead | SentWorking"));
  });

  it("u505_selecting_a_row_selects_its_workstream", async () => {
    const { connected } = await mountAskBar([typed]);
    const select = vi.spyOn(connected.rail, "select");

    await waitFor(() => expect(rowTexts()).toHaveLength(1));
    fireEvent.click(document.querySelector<HTMLElement>(".ask-row button.ask-line")!);

    await waitFor(() => expect(connected.rail.selected()).toBe("ops"));
    expect(document.querySelector(".ask-input")).toBeNull();
    expect(select).toHaveBeenCalledExactlyOnceWith("ops");
  });

  it("u505_arrows_move_between_openable_rows", async () => {
    const { connected } = await mountAskBar([
      ask("last", 1, [{ text: "last", placement: { kind: "routed", workstream: "lead" }, state: "queued" }]),
      ask("plain", 2, [{ text: "plain", placement: { kind: "unclear", question: "Which?", candidates: ["ops"] }, state: "waiting" }]),
      typed,
    ]);
    const first = await screen.findByRole("button", { name: /ship it/ });
    const last = screen.getByRole("button", { name: /last/ });
    first.focus();
    press("ArrowUp");
    expect(document.activeElement).toBe(first);
    press("ArrowDown");
    expect(document.activeElement).toBe(last);
    press("ArrowDown");
    expect(document.activeElement).toBe(last);
    press("ArrowUp");
    expect(document.activeElement).toBe(first);
    fireEvent.click(document.activeElement!);
    expect(connected.rail.selected()).toBe("ops");
  });

  it("u505_a_row_is_a_button_named_by_its_cells", async () => {
    await mountAskBar([typed, ask("plain", 1, [{ text: "plain", placement: { kind: "new", title: "future" }, state: "placing" }])]);
    expect(await screen.findByRole("button", { name: /ship it.*Needs-you.*ops.*Sent/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /plain/ })).toBeNull();
  });

  it("u505_a_failed_row_shows_its_reason", async () => {
    await mountAskBar([ask("a1", 1, [{ text: "go", placement: { kind: "routed", workstream: "ops" }, state: "failed", reason: "the Door ended before this reached it" }])]);

    await waitFor(() => expect(document.querySelector(".ask-reason")?.textContent).toBe("the Door ended before this reached it"));
    expect(rowTexts()).toEqual(["go | ops | Failed"]);
  });
});
