import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { ask, mountAskBar } from "./askFixture";

afterEach(cleanup);

const unclear = ask("a1", 1, [{ text: "tidy up", placement: { kind: "unclear", question: "Which one?", candidates: ["lead", "ops"] }, state: "waiting" }]);

const picks = (app: { calls: { method: string; params: unknown }[] }) => app.calls.filter((call) => call.method === "ask.pick").map((call) => call.params);

const elements = () => [...document.querySelectorAll<HTMLButtonElement>(".ask-choices button:not(.app-select-trigger)")];

const buttons = () => elements().map((button) => button.textContent);

describe("u506 an unclear row asks back", () => {
  it("u506_picking_a_candidate_delivers_the_part", async () => {
    const { app } = await mountAskBar([unclear]);

    app.handlers["ask.pick"] = () => ask("a1", 1, [{ text: "tidy up", placement: { kind: "routed", workstream: "ops" }, state: "queued" }]);
    await waitFor(() => expect(document.querySelector(".ask-reason")?.textContent).toBe("Which one?"));
    expect(buttons()).toEqual(["lead", "ops", "New Workstream", "Drop"]);
    expect(document.querySelector(".app-select-trigger")?.textContent).toContain("Another Workstream");

    fireEvent.click([...document.querySelectorAll<HTMLButtonElement>(".ask-choices button")].find((button) => button.textContent === "ops")!);

    await waitFor(() => expect(document.querySelector(".ask-state")?.textContent).toBe("Queued for the supervisor"));
    expect(picks(app)).toEqual([{ id: "a1", part: 0, target: { kind: "workstream", id: "ops" } }]);
    expect(document.querySelector(".ask-back")).toBeNull();
  });

  it("u506_new_workstream_and_drop", async () => {
    const { app } = await mountAskBar([unclear]);

    // The part stays waiting after the first pick, so both buttons can be pressed on the one row.
    app.handlers["ask.pick"] = () => unclear;
    await waitFor(() => expect(buttons()).toContain("Drop"));

    const press = (name: string) => fireEvent.click(elements().find((button) => button.textContent === name)!);

    press("New Workstream");
    await waitFor(() => expect(picks(app)).toHaveLength(1));
    await waitFor(() => expect(elements().every((button) => !button.disabled)).toBe(true));
    press("Drop");
    await waitFor(() => expect(picks(app)).toEqual([{ id: "a1", part: 0, target: { kind: "new" } }, { id: "a1", part: 0, target: { kind: "drop" } }]));
  });

  it("u506_a_failed_row_offers_each_recovery_once", async () => {
    const failed = ask("a1", 1, [{ text: "/clear", placement: { kind: "routed", workstream: "lead" }, state: "failed", reason: "agent lead did not accept the prompt" }]);

    for (const target of [{ kind: "workstream", id: "ops" }, { kind: "new" }, { kind: "drop" }]) {
      const { app } = await mountAskBar([failed]);
      app.handlers["ask.pick"] = () => failed;

      await waitFor(() => expect(screen.getByRole("button", { name: "Drop" })).toBeTruthy());

      if (target.kind === "workstream") {
        fireEvent.click(screen.getByRole("combobox", { name: "Another Workstream" }));
        const option = await screen.findByRole("option", { name: "ops" });
        fireEvent.click(option);
      } else {
        fireEvent.click(screen.getByRole("button", { name: target.kind === "new" ? "New Workstream" : "Drop" }));
      }

      await waitFor(() => expect(picks(app)).toEqual([{ id: "a1", part: 0, target }]));
      cleanup();
    }
  });

  it("u506_the_buttons_are_reachable_by_keyboard", async () => {
    await mountAskBar([unclear]);

    await waitFor(() => expect(buttons()).toHaveLength(4));

    for (const control of document.querySelectorAll<HTMLElement>(".ask-choices button, .ask-choices .app-select-trigger")) {
      expect(control.tabIndex).toBeGreaterThanOrEqual(0);
      expect(control.hasAttribute("disabled")).toBe(false);
    }
  });
});
