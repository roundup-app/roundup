import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { answerQuestion } from "../shelf/bulkQuestionHarness";
import { bubbleCalls, mountBubbles } from "./bubblesFixture";

afterEach(cleanup);

const closeButton = (name: string) => document.querySelector<HTMLButtonElement>(`[aria-label="Close ${name}"]`)!;

/** Terminal 2 (zsh) fails to close, so its failure line shows Retry. */
const failTerminalTwo = async () => {
  const mounted = await mountBubbles();
  const succeed = mounted.app.handlers["terminal.close"]!;

  mounted.app.handlers["terminal.close"] = (params) => {
    if (params.id === "2") throw new Error("cannot close zsh");

    return succeed(params);
  };

  fireEvent.click(closeButton("zsh"));
  await answerQuestion(true);
  await waitFor(() => expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy());

  return { ...mounted, succeed };
};

it("u3661_closing_another_terminal_keeps_the_failed_close_retry", async () => {
  const { app } = await failTerminalTwo();

  fireEvent.click(closeButton("cargo test"));
  await answerQuestion(true);
  await waitFor(() => expect(bubbleCalls(app, "terminal.close")).toEqual([{ id: "2" }, { id: "1" }]));
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("cannot close zsh");
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await answerQuestion(true);
  await waitFor(() => expect(bubbleCalls(app, "terminal.close")).toEqual([{ id: "2" }, { id: "1" }, { id: "2" }]));
});

it("u3661_cancelling_another_close_keeps_the_failed_close_retry", async () => {
  const { app } = await failTerminalTwo();

  fireEvent.click(closeButton("cargo test"));
  await answerQuestion(false);
  expect(bubbleCalls(app, "terminal.close")).toEqual([{ id: "2" }]);
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("cannot close zsh");
  expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
});

it("u3661_a_later_failure_replaces_the_earlier_retry", async () => {
  const { app, succeed } = await failTerminalTwo();
  const before = app.handlers["terminal.close"]!;

  app.handlers["terminal.close"] = (params) => {
    if (params.id === "1") throw new Error("cannot close cargo");

    return before(params);
  };

  fireEvent.click(closeButton("cargo test"));
  await answerQuestion(true);
  await waitFor(() => expect(document.querySelector('[role="alert"]')?.textContent).toContain("cannot close cargo"));
  expect(document.querySelector('[role="alert"]')?.textContent).not.toContain("cannot close zsh");
  app.handlers["terminal.close"] = succeed;
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await answerQuestion(true);
  await waitFor(() => expect(bubbleCalls(app, "terminal.close")).toEqual([{ id: "2" }, { id: "1" }, { id: "1" }]));
});
