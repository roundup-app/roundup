// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { App } from "../App";
import type { AppSeam } from "../app/seam";
import { fakeEmulators } from "../terminal/paneHarness";
import { showShelfTab } from "./shelfTabs";
import { createServedApp } from "./realSeam";
import { startRealDaemon } from "./realDaemonFixture";
import type { StartedDaemon } from "./realDaemonFixture";

let real: StartedDaemon;

beforeAll(async () => {
  real = await startRealDaemon({
    FAKE_CLAUDE_DOOR_TOOLS: JSON.stringify([
      { name: "todo_create", arguments: { title: "ship j4" } },
      { name: "pad_create", arguments: { name: "j4-notes", text: "" } },
    ]),
  });
}, 120_000);

afterAll(async () => {
  await real?.stop();
});

afterEach(cleanup);

describe("u347 a Workstream's Shelf shows its own Todos and Pads on the real Daemon", () => {
  it("u347_the_first_workstream_lists_its_two_the_second_reads_none_and_all_lists_both", async () => {
    const app: AppSeam = createServedApp(real.base);

    render(() => <App app={app} reducedMotion={() => false} clock={Date.now} createEmulator={fakeEmulators().factory} />);

    const rail = await screen.findByRole("region", { name: "rail" });
    const workstreams = async () => (await app.rpc("rail.tree", null)).filter((node) => node.kind === "workstream");

    fireEvent.click((await screen.findAllByRole("button", { name: /^(New Workstream|Add Workstream)$/ }))[0]!);
    fireEvent.click(await within(rail).findByRole("button", { name: /Start Door/i }));

    const [first] = await waitFor(async () => {
      const found = await workstreams();

      expect(found).toHaveLength(1);

      return found;
    });

    await waitFor(async () => {
      expect((await app.rpc("todo.list", null)).find((todo) => todo.title === "ship j4")?.home).toBe(first!.id);
      expect((await app.rpc("pad.list", null)).find((pad) => pad.name === "j4-notes")?.home).toBe(first!.id);
    }, { timeout: 60_000 });

    // The Rail marks `New Workstream` aria-disabled while the selected Door is pending, and it drops a click then.
    const add = () => within(rail).getByRole("button", { name: /^\s*(New Workstream|Add Workstream)$/ });

    await waitFor(() => expect(add().getAttribute("aria-disabled")).not.toBe("true"), { timeout: 30_000 });
    fireEvent.click(add());
    await waitFor(async () => expect(await workstreams()).toHaveLength(2), { timeout: 30_000 });

    const second = (await workstreams()).find((node) => node.id !== first!.id)!;

    const select = (id: string) => fireEvent.click(rail.querySelector(`[data-id="${id}"] .name`) ?? rail);

    const list = async (name: "Todos" | "Pads") => {
      showShelfTab(name);

      return await screen.findByRole("region", { name: name.toLowerCase() });
    };

    select(second.id);
    expect(await within(await list("Todos")).findByText(/no todos in this workstream/)).toBeTruthy();
    expect(await within(await list("Pads")).findByText(/no pads in this workstream/)).toBeTruthy();

    select(first!.id);
    const pads = await list("Pads");

    await within(pads).findByText(/j4-notes/);
    expect(pads.querySelectorAll("[data-shelf-row]")).toHaveLength(1);

    const todos = await list("Todos");

    await within(todos).findByText(/ship j4/);
    expect(todos.querySelectorAll("[data-shelf-row]")).toHaveLength(1);

    fireEvent.click(within(todos).getByRole("button", { name: "all" }));
    await waitFor(() => expect(todos.textContent).toContain("ship j4"));
    expect((await list("Pads")).textContent).toContain("j4-notes");
  }, 180_000);
});
