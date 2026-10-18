import { cleanup, fireEvent, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { event } from "../testing/nodes";
import { ask, mountAskBar, rowTexts } from "./askFixture";

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

    await waitFor(() => expect(rowTexts()).toHaveLength(1));
    fireEvent.click(document.querySelector<HTMLElement>(".ask-row button.ask-line")!);

    await waitFor(() => expect(connected.rail.selected()).toBe("ops"));
    expect(document.querySelector(".ask-input")).toBeNull();
  });

  it("u505_a_failed_row_shows_its_reason", async () => {
    await mountAskBar([ask("a1", 1, [{ text: "go", placement: { kind: "routed", workstream: "ops" }, state: "failed", reason: "the Door ended before this reached it" }])]);

    await waitFor(() => expect(document.querySelector(".ask-reason")?.textContent).toBe("the Door ended before this reached it"));
    expect(rowTexts()).toEqual(["go | ops | Failed"]);
  });
});
