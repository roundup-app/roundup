import { fireEvent, waitFor, within } from "@solidjs/testing-library";
import { describe, expect, it } from "vitest";
import { askingWith, card, decision, mountApp, rpcCalls, select } from "./decisionsFixture";

describe("u471 Decisions use sentence case", () => {
  it("u471_previous_copy_assertions_are_preserved_permission_controls_use_sentence_case", async () => {
    const { app } = await mountApp([decision("d1", "a")]);
    select("alpha");
    await waitFor(() => expect(card()).not.toBeNull());

    expect(within(card()!).getAllByRole("button").map((button) => button.textContent)).toEqual(["Allow", "Deny"]);
    fireEvent.click(within(card()!).getByRole("button", { name: "Allow" }));
    await waitFor(() => expect(rpcCalls(app, "decision.answer")[0]).toMatchObject({ answer: "allow" }));
  });

  it("u471_previous_copy_assertions_are_preserved_question_controls_use_sentence_case", async () => {
    await mountApp([askingWith("d1", "a", "keep lowercase?", [{ label: "keep v1 (recommended)", description: "leave it alone", preview: "lowercase preview" }])]);
    select("alpha");
    await waitFor(() => expect(card()).not.toBeNull());

    const view = within(card()!);
    expect(view.getByRole("listbox", { name: "Answers" })).toBeTruthy();
    expect(view.getByText("Recommended")).toBeTruthy();
    const note = view.getByRole("textbox", { name: "Note" });
    expect(note.getAttribute("placeholder")).toBe("Note for keep v1 (recommended), or your own answer");
    expect(view.getByRole("button", { name: "Send" })).toBeTruthy();
    fireEvent.keyDown(note, { key: "ArrowUp" });
    await waitFor(() => expect(note.getAttribute("placeholder")).toBe("Your own answer"));
  });

  it("u471_previous_copy_assertions_are_preserved_agent_question_text_stays_as_written", async () => {
    await mountApp([askingWith("d1", "a", "keep lowercase?", [{ label: "keep v1 (recommended)", description: "leave it alone", preview: "lowercase preview" }])]);
    select("alpha");
    await waitFor(() => expect(card()).not.toBeNull());

    const view = within(card()!);

    for (const text of ["alpha asks", "keep lowercase?", "keep v1", "leave it alone", "lowercase preview"]) expect(view.getByText(text)).toBeTruthy();
  });

  it.each([false, true])("u471_previous_copy_assertions_are_preserved_terminal_fallback_uses_sentence_case_unreadable_%s", async (unreadable) => {
    await mountApp([decision("d1", "a", unreadable ? { tool: "ask_user", args: "bad json" } : { answerable: false })]);
    select("alpha");
    await waitFor(() => expect(card()).not.toBeNull());

    const view = within(card()!);
    expect(view.getByRole("button", { name: "Focus Terminal" })).toBeTruthy();
    expect(view.getByText(unreadable ? "Unreadable question: Answer in the Terminal" : "Answer in the Terminal")).toBeTruthy();
    expect(view.queryByRole("button", { name: "Allow" })).toBeNull();
  });
});
