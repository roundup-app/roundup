// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "../App";
import type { AppSeam } from "../app/seam";
import { fakeEmulators } from "../terminal/paneHarness";
import { createServedApp } from "./realSeam";
import { startRealDaemon } from "./realDaemonFixture";
import type { StartedDaemon } from "./realDaemonFixture";

let real: StartedDaemon;

beforeEach(async () => {
  // E10: the Door's Claude is the pinned one, its model aimock serving this file's turns.
  real = await startRealDaemon({}, false, undefined, resolve(process.cwd(), "src/testing/fixtures/u194_long_command.json"));
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

describe("a3564a a Door's native prompt is attended to in its own Terminal on the real Daemon", () => {
  it("a3564a_attention_opens_the_requesting_terminal", async () => {
    const app = mount();

    fireEvent.click((await screen.findAllByRole("button", { name: /^(New Workstream|Add Workstream)$/ }))[0]!);

    const rail = await screen.findByRole("region", { name: "Rail" });

    fireEvent.click(await within(rail).findByRole("button", { name: /Start supervisor/i }));

    const door = async () => (await app.rpc("rail.tree", null)).find((node) => node.kind === "workstream")!;

    await waitFor(async () => expect((await door()).status?.kind).toBe("needs-you"), { timeout: 90_000 });

    // The Door's prompt stays in its Terminal: no roundup form appears, and selecting the row opens that Terminal.
    expect(screen.queryByRole("region", { name: / wants to / })).toBeNull();
    fireEvent.click(rail.querySelector(`[data-id="${(await door()).id}"] .name`)!);
    const id = (await door()).id;

    await waitFor(() => expect(rail.querySelector("[data-selected=true]")?.getAttribute("data-id")).toBe(id));
    expect(screen.queryByRole("region", { name: / wants to / })).toBeNull();
    await real.model!.assertMatched();
  }, 240_000);
});
