import { fireEvent, waitFor, within } from "@solidjs/testing-library";
import { describe, expect, it } from "vitest";
import { RpcError } from "../app/seam";
import { askingWith, card, decision, mountApp, select } from "./decisionsFixture";

const idLeak = /\bd1\b|Attempt|original prompt|identity/;

describe("u3750 a question the Card cannot answer", () => {
  it("u3750_the_card_names_the_terminal_and_no_id", async () => {
    const { app } = await mountApp([decision("d1", "a", { tool: "ask_user", answerable: false, args: JSON.stringify({ answers: [{ label: "Yes", description: "go" }], question: "Proceed?" }) })]);

    select("alpha");
    await waitFor(() => expect(card()).not.toBeNull());
    expect(card()!.querySelector("textarea")).toBeNull();
    expect(within(card()!).queryAllByRole("option")).toEqual([]);
    expect(card()!.textContent).toContain("Answer in the Terminal");
    expect(within(card()!).getAllByRole("button").map((button) => button.textContent?.trim())).toEqual(["Focus Terminal"]);
    expect(card()!.textContent).not.toMatch(idLeak);
    expect(app.calls.filter((call) => call.method === "decision.answer")).toEqual([]);
  });

  it("u3750_a_refused_answer_shows_the_same_line", async () => {
    const { app } = await mountApp([askingWith("d1", "a", "Proceed?", [{ label: "Yes", description: "go" }])]);

    app.handlers["decision.answer"] = () => { throw new RpcError(-32001, "original prompt d1 Attempt 1 identity unavailable"); };

    select("alpha");
    await waitFor(() => expect(card()?.querySelector("textarea")).toBeTruthy());
    fireEvent.input(card()!.querySelector("textarea")!, { target: { value: "mine" } });
    fireEvent.submit(card()!.querySelector("textarea")!.form!);
    await waitFor(() => expect(within(card()!).getByRole("alert").textContent).toContain("Answer in the Terminal"));
    expect(card()!.textContent).not.toMatch(idLeak);
    expect(card()!.querySelector("textarea")!.value).toBe("mine");
  });
});
