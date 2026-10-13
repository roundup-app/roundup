import { fireEvent, waitFor, within } from "@solidjs/testing-library";
import { describe, expect, it } from "vitest";
import { askingWith, card, decision, mountApp, rpcCalls, select } from "./decisionsFixture";

describe("u416 Decisions use sentence case", () => {
  it("u416_permission_controls_use_sentence_case", async () => {
    const { app } = await mountApp([decision("d1", "a")]);
    select("alpha");
    await waitFor(() => expect(card()).not.toBeNull());

    expect(within(card()!).getAllByRole("button").map((button) => button.textContent)).toEqual(["Allow", "Deny"]);
    fireEvent.click(within(card()!).getByRole("button", { name: "Allow" }));
    await waitFor(() => expect(rpcCalls(app, "decision.answer")[0]).toMatchObject({ answer: "allow" }));
  });
});
