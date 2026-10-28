import { door } from "../testing/nodes";
import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { mountNavigation } from "../testing/navigationFixture";

afterEach(() => { cleanup(); localStorage.clear(); sessionStorage.clear(); });

const press = (code: string, init: KeyboardEventInit = {}) => document.body.dispatchEvent(new KeyboardEvent("keydown", { code, key: code.replace(/^Key/, "").toLowerCase(), bubbles: true, cancelable: true, ...init }));

it.each(["leader", "rail"])("u4453b_back_to_ask_by_leader_and_rail: %s", async by => {
  const { connected, daemon, nodes } = await mountNavigation();
  nodes.push(door("running", "working", "Working"));
  await connected().rail.refresh();
  const draft = "  Keep this exact draft\nfor my original Project 🦉";
  fireEvent.input(screen.getByRole("textbox", { name: "Ask" }), { target: { value: draft } });

  for (const id of ["a0", "running", "home"]) {
    connected().rail.select(id);
    await waitFor(() => expect(connected().rail.selected()).toBe(id));

    if (by === "leader") {
      press("KeyK", { metaKey: true });
      press("KeyA");
    } else {
      fireEvent.click(screen.getAllByRole("button", { name: /^Overview/ })[0]!);
    }

    const field = await screen.findByRole("textbox", { name: "Ask" });
    expect(connected().rail.selected()).toBeNull();
    expect(connected().view()).toBeNull();
    expect(field).toHaveProperty("value", draft);
  }

  expect(daemon.calls.filter(call => ["agent.spawn", "terminal.open", "ask.send", "message.send"].includes(call.method))).toHaveLength(0);
});
