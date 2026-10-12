// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "../App";
import type { AppSeam } from "../app/seam";
import { fakeEmulators } from "../terminal/paneHarness";
import { createServedApp } from "./realSeam";
import { startRealDaemon } from "./realDaemonFixture";
import type { StartedDaemon } from "./realDaemonFixture";

let real: StartedDaemon;

beforeEach(async () => {
  real = await startRealDaemon({
    FAKE_CLAUDE_ON_PROMPT: JSON.stringify({ name: "todo_create", arguments: { title: "$prompt" } }),
    FAKE_CLAUDE_ON_PROMPT_ASK: JSON.stringify({ tool_name: "Bash", tool_input: { command: `echo ${"x".repeat(300)}` } }),
  });
}, 120_000);

afterEach(async () => {
  cleanup();
  await real?.stop();
});

const mount = () => {
  const app: AppSeam = createServedApp(real.base);

  render(() => <App app={app} reducedMotion={() => false} clock={Date.now} createEmulator={fakeEmulators().factory} />);

  return app;
};

describe("u194 a long command's Decision is answered by pointer on the real Daemon", () => {
  it("u194_allow_by_pointer_clears_the_decision_and_the_workstream_reads_idle", async () => {
    const app = mount();

    fireEvent.click((await screen.findAllByRole("button", { name: /^(new Workstream|Add Workstream)$/ }))[0]!);

    const rail = await screen.findByRole("region", { name: "rail" });

    fireEvent.click(await within(rail).findByRole("button", { name: /start Door/i }));

    const card = () => screen.queryByRole("region", { name: /Decision for/ });
    const kind = async () => (await app.rpc("rail.tree", null)).find((node) => node.kind === "workstream")?.status?.kind;

    await waitFor(() => expect(card()).not.toBeNull(), { timeout: 90_000 });
    expect(card()!.textContent).toContain("x".repeat(300));

    // The Door asks once for its Clarification order and once for the prompt it then hears; each is answered by clicking `allow`.
    // jsdom has no layout, so the click is dispatched at the button the Card holds; the pointer's reach is observed in a browser.
    // The second ask can land just after the first answer leaves the list empty, so quiet must hold across several polls.
    let quiet = 0;

    await waitFor(async () => {
      const open = card();

      if (open) fireEvent.click(within(open).getByRole("button", { name: "allow" }));
      const settled = (await app.rpc("decision.list", null)).length === 0 && (await kind()) === "idle" && !card();

      quiet = settled ? quiet + 1 : 0;
      expect(quiet).toBeGreaterThanOrEqual(5);
    }, { timeout: 90_000, interval: 1000 });
  }, 240_000);
});
