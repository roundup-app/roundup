import { afterEach, expect, it, vi } from "vitest";
import { createFakeApp } from "../testing/fakeApp";
import { connectProject } from "../state/connectedProject";
import { createXtermEmulators } from "./emulator";

afterEach(() => { vi.unstubAllGlobals(); delete document.documentElement.dataset.mode; });

const scheme = (dark: boolean) => {
  // jsdom does not evaluate prefers-color-scheme; the explicit selector resolves the same Tokens.
  document.documentElement.dataset.mode = dark ? "dark" : "light";
  let change: () => void = () => {};

  const query = { matches: dark, addEventListener: (_: string, listener: () => void) => { change = listener; }, removeEventListener: () => { change = () => {}; } };

  vi.stubGlobal("matchMedia", () => query);

  return { switchTo: (next: boolean) => { query.matches = next; document.documentElement.dataset.mode = next ? "dark" : "light"; change(); } };
};

const schemeCalls = (app: ReturnType<typeof createFakeApp>) => app.calls.filter((call) => call.method === "terminal.scheme").map((call) => call.params);

it("x17_connecting_tells_the_daemon_the_scheme_and_each_switch_tells_it_again", async () => {
  const window = scheme(false);
  const app = createFakeApp();

  await connectProject(app, { name: "p", path: "/p" }, () => false, () => 0);
  window.switchTo(true);

  expect(schemeCalls(app)).toEqual([
    { scheme: "light", background: "#ffffff", foreground: "#4d4d4c" },
    { scheme: "dark", background: "#282c34", foreground: "#ffffff" },
  ]);
});

it("x17_the_emulator_leaves_a_colour_query_and_da1_to_the_daemon", async () => {
  const emulator = createXtermEmulators(undefined, () => ({ activate() {}, dispose() {}, onContextLoss() { return { dispose() {} }; } }))("t-x17");
  const typed: Uint8Array[] = [];

  emulator.onInput((bytes) => typed.push(bytes));
  await new Promise<void>((resolve) => emulator.write(new TextEncoder().encode("\x1b]10;?\x1b\\\x1b]11;?\x1b\\\x1b[c"), resolve));

  expect(typed).toEqual([]);
  emulator.dispose();
});

it("x17_ending_the_connection_stops_following_the_window", async () => {
  const window = scheme(false);
  const app = createFakeApp();
  const connected = await connectProject(app, { name: "p", path: "/p" }, () => false, () => 0);

  connected.stopTerminalScheme();
  window.switchTo(true);

  expect(schemeCalls(app)).toHaveLength(1);
});


it("u3791c_rejected_actions_reach_their_owner_scheme", async () => {
  const window = scheme(false);
  const app = createFakeApp();
  let refused = true;


  app.handlers["terminal.scheme"] = () => {
    if (refused) throw new Error("scheme unavailable");

    return null;
  };

  const connected = await connectProject(app, { name: "p", path: "/p" }, () => false, () => 0);
  expect(schemeCalls(app)).toHaveLength(1);
  expect(connected.terminalScheme.failure()).not.toBeNull();
  refused = false;
  await connected.terminalScheme.retry();
  expect(connected.terminalScheme.failure()).toBeNull();
  expect(schemeCalls(app)).toHaveLength(2);
  connected.stopTerminalScheme();
  window.switchTo(true);
  expect(schemeCalls(app)).toHaveLength(2);
});
