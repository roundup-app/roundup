import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { door, USER } from "../testing/nodes";
import { message, mountThread } from "./threadFixture";

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
