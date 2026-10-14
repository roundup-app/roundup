import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { door, USER } from "../testing/nodes";
import { message, mountThread, threadInput } from "./threadFixture";

afterEach(cleanup);

it("u416_thread_controls_use_sentence_case_and_preserve_authored_text", async () => {
  const { container } = await mountThread([door("w", "idle", "idle", {
    name: "workstream",
    work: { kind: "clarification", question: "keep MY words?" },
  })], { messages: [message(1, { from: { kind: "agent", id: "w", parent: null }, to: "you", kind: "question", body: "keep THIS question?" })] });

  expect(screen.getByRole("button", { name: "Order of workstream" }).textContent).toBe("keep MY words?");
  expect(screen.getByRole("log", { name: "Thread" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Send" })).toBeTruthy();
  fireEvent.click(await screen.findByRole("button", { name: "Answer" }));
  expect(container.querySelector("[data-answering]")?.textContent).toContain("Answering workstream");
  expect(screen.getByRole("button", { name: "Dismiss answer" })).toBeTruthy();
  expect(container.querySelector("[data-need]")?.textContent).toContain("keep THIS question?");
});

it.each([
  ["pending", null, "Queued"],
  ["held", "escalated", "Waiting for you: Answer below"],
  ["held", "ask-first", "Waiting for approval"],
  ["held", "takeover", "Waiting until the Takeover ends"],
  ["dropped", null, "Not delivered"],
  ["dropped", "receiver gone", "Not delivered: The receiver is gone"],
  ["dropped", "not accepted", "Not delivered: The receiver did not accept it"],
  ["dropped", "passed", "Not delivered: It was passed on"],
  ["dropped", "merged", "Not delivered: It was merged into another"],
  ["dropped", "escalated", "Not delivered: It was not answered"],
  ["dropped", "ask-first", "Not delivered: It needed approval"],
  ["dropped", "takeover", "Not delivered: A Takeover was under way"],
] as const)("u416_thread_status_uses_sentence_case_for_%s_%s", async (status, reason, label) => {
  const { container } = await mountThread([door("w", "idle", "idle")], {
    messages: [message(1, { from: USER, to: "w", status, reason, body: "keep MY message" })],
  });

  await waitFor(() => expect(container.querySelector("[data-message-status]")?.textContent).toBe(label));
  expect(container.querySelector("[data-message-body]")?.textContent).toBe("keep MY message");
});

it("u416_thread_clear_prompt_uses_sentence_case_and_preserves_the_workstream_name", async () => {
  await mountThread([door("w", "idle", "idle", { name: "workstream" })]);
  fireEvent.click(screen.getByRole("button", { name: "More" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Clear…" }));
  expect(screen.getByRole("textbox", { name: "Why clear workstream?" })).toBeTruthy();
  const prompt = within(document.querySelector<HTMLElement>("[data-clear-prompt]")!);
  expect(prompt.getByRole("button", { name: "Clear" })).toBeTruthy();
  expect(prompt.getByRole("button", { name: "Keep" })).toBeTruthy();
  expect(prompt.getByText("The Door writes a Handoff, keeps what you asked for, archives the rest, and stops 0 Subagents; their files stay")).toBeTruthy();
});

it("u416_thread_quote_labels_keep_glossary_case_and_preserve_quoted_text", async () => {
  const { container } = await mountThread([door("w", "idle", "idle")], {
    messages: [message(7, { from: USER, to: "w", body: "keep MY quote" })],
  });

  const body = await waitFor(() => {
    const found = container.querySelector("[data-message-body]");

    expect(found).not.toBeNull();

    return found!;
  });

  document.getSelection()!.selectAllChildren(body);
  document.dispatchEvent(new Event("selectionchange"));
  document.getSelection()!.removeAllRanges();
  fireEvent.keyDown(threadInput(), { key: "x" });
  expect(screen.getByRole("button", { name: "Remove Quote from Message 7" })).toBeTruthy();
  expect(container.querySelector("[data-quote]")?.getAttribute("title")).toBe("keep MY quote");
});
