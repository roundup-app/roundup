import { cleanup, fireEvent, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeEach, expect, it } from "vitest";
import { info } from "../testing/nodes";
import { mountBubbles, TERMINALS } from "./bubblesFixture";

const closeControl = () => document.querySelector('[aria-label="Close cargo test"]') ?? document.body;

beforeEach(() => { window.localStorage.clear(); });

afterEach(cleanup);

it("u7157a_closing_an_ended_terminal_sends_close_with_no_question", async () => {
  const { app } = await mountBubbles("a", [info("1", { owner: "a", title: "cargo test", running: false }), ...TERMINALS.slice(1)]);

  fireEvent.click(closeControl());
  await waitFor(() => expect(app.calls.filter(call => call.method === "terminal.close")).toHaveLength(1));
  expect(app.questions).toHaveLength(0);
});

it("u7157a_a_running_terminal_still_asks", async () => {
  const { app } = await mountBubbles();

  fireEvent.click(closeControl());
  await waitFor(() => expect(app.questions).toHaveLength(1));
  expect(app.calls.filter(call => call.method === "terminal.close")).toHaveLength(0);
});
