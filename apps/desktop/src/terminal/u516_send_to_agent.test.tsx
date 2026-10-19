import { cleanup } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { agent } from "../testing/nodes";
import { fireEvent, mountSend, screen, waitFor } from "./sendHarness";

afterEach(() => { cleanup(); window.localStorage.clear(); });

const send = async () => {
  fireEvent.click(await screen.findByRole("button", { name: "Send to agent" }));
};

it("u516_the_webview_sends_one_message_and_never_interrupts_or_retries", async () => {
  const view = await mountSend([agent("a", "working", "busy", { name: "Alpha" })], () => {
    throw new Error("Alpha has 32 messages waiting");
  });

  view.emulator.select("ls");
  await send();
  await screen.findByText("Could not send to Alpha: Alpha has 32 messages waiting");
  expect(view.app.calls.map((call) => call.method).filter((method) => method.startsWith("agent.") || method === "terminal.write")).toEqual([]);
  expect(view.calls()).toEqual([{ to: "a", kind: "note", body: "```\nls\n```", replyTo: null }]);
});

it("u516_the_body_carries_the_turn_facts_of_the_selection", async () => {
  const view = await mountSend([agent("a", "idle", "waiting")]);

  view.emulator.select("$ ls\nfile", { command: "ls", cwd: "/work", exit: 0 });
  await send();
  await waitFor(() => expect(view.calls()).toHaveLength(1));
  expect(view.calls()[0]!.body).toBe("```\n$ ls\nfile\n```\n\ncommand: ls\ncwd: /work\nexit: 0");
});

it("u516_a_sent_excerpt_toasts_the_agent_it_went_to", async () => {
  const view = await mountSend([agent("a", "idle", "waiting", { name: "Alpha" })]);

  view.emulator.select("ls");
  await send();
  expect(await screen.findByRole("button", { name: "Sent to Alpha" })).toBeTruthy();
  expect(view.chimes.count).toBe(0);
});

it("u516_the_toast_selects_a_background_agent", async () => {
  const view = await mountSend([agent("a", "idle", "waiting", { name: "Alpha" })]);

  expect(view.connected.rail.selected()).toBe("sh");
  view.emulator.select("ls");
  await send();
  fireEvent.click(await screen.findByRole("button", { name: "Sent to Alpha" }));
  await waitFor(() => expect(view.connected.rail.selected()).toBe("a"));
});

it("u516_a_rejected_send_says_why_and_keeps_the_selection", async () => {
  let fail = true;

  const view = await mountSend([agent("a", "idle", "waiting", { name: "Alpha" })], () => {
    if (fail) throw new Error("receiver ended");
  });

  view.emulator.select("ls");
  fireEvent.input(await screen.findByRole("textbox", { name: "Add a note (optional)" }), { target: { value: "keep me" } });
  await send();
  await screen.findByRole("button", { name: "Could not send to Alpha: receiver ended" });
  expect(screen.getByRole<HTMLInputElement>("textbox", { name: "Add a note (optional)" }).value).toBe("keep me");
  expect(view.emulator.selection()).toBe("ls");
  fail = false;
  await send();
  await waitFor(() => expect(view.calls()).toHaveLength(2));
  expect(view.calls()[1]!.body).toBe("keep me\n\n```\nls\n```");
});
