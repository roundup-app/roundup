// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";
import type { AppSeam } from "../app/seam";
import { fakeEmulators } from "../terminal/paneHarness";
import { createServedApp } from "./realSeam";
import { startRealDaemon } from "./realDaemonFixture";
import type { StartedDaemon } from "./realDaemonFixture";

let real: StartedDaemon | undefined;

let folder: string | undefined;

afterEach(async () => {
  cleanup();
  await real?.stop();

  if (folder) await rm(folder, { recursive: true, force: true });
  real = undefined;
  folder = undefined;
});

/** The Door's fake `claude` runs this child: for each round it waits for the test's go file, then sends that round's body as the Door. */
const DOOR_SENDS = 'for n in 1 2 3; do until [ -f "$U3783_DIR/go$n" ]; do sleep 0.05; done; "$U3783_RUP" message send "$(cat "$U3783_DIR/to")" note "$(cat "$U3783_DIR/body$n")"; done';

describe("u3783 a Door's note meets its Route on the real Daemon", () => {
  it("u3783_a_real_door_note_waits_under_ask_first", async () => {
    folder = await mkdtemp(join(tmpdir(), "u3783-"));
    const prompts = join(folder, "prompts.jsonl");
    const typed = async (body: string) => (await readFile(prompts, "utf8").catch(() => "")).split("\n").filter((line) => line.includes(body));

    real = await startRealDaemon({
      FAKE_CLAUDE_PROMPT_LOG: prompts,
      FAKE_CLAUDE_DOOR_PROCESS: JSON.stringify(["sh", "-c", DOOR_SENDS]),
      U3783_DIR: folder,
      U3783_RUP: resolve(process.cwd(), "../../target/debug/rup"),
    });

    const app: AppSeam = createServedApp(real.base);
    const calls = vi.spyOn(app, "rpc");
    const workstream = await app.rpc("rail.createWorkstream", { name: "Crew", parent: null });
    const agent = await app.rpc("agent.spawn", { cwd: real.dir, parent: workstream.id, prompt: null, name: "Ann", order: { kind: "work", ask: "wait", limits: [] } });
    const status = async (id: string) => (await app.rpc("rail.tree", null)).find((node) => node.id === id)?.status?.kind;

    await app.rpc("rail.startDoor", { id: workstream.id });
    await waitFor(async () => {
      expect(await status(agent.id)).toBe("idle");
      expect(await status(workstream.id)).toBe("idle");
    }, { timeout: 60_000 });

    await writeFile(join(folder, "to"), agent.id);
    render(() => <App app={app} reducedMotion={() => false} clock={Date.now} createEmulator={fakeEmulators().factory} />);

    // Every row the queue ever draws, so a note that flashes in and out still counts as appearing.
    const seen = new Set<string>();
    const watch = new MutationObserver(() => document.querySelectorAll(".note-queue-text").forEach((row) => seen.add(row.textContent ?? "")));

    watch.observe(document.body, { subtree: true, childList: true, characterData: true });

    const rail = await screen.findByRole("region", { name: "Rail" });

    const select = async (id: string) => fireEvent.click(await waitFor(() => {
      const name = rail.querySelector<HTMLElement>(`.rail-row[data-id="${id}"] .name`);

      expect(name).not.toBeNull();

      return name!;
    }, { timeout: 30_000 }));

    await select(workstream.id);
    await select(agent.id);
    const selected = (await app.rpc("rail.tree", null)).find(node => node.id === agent.id)!;

    await waitFor(() => expect(document.querySelector(".pane-screen [data-terminal]")?.getAttribute("data-terminal")).toBe(selected.terminal_id));

    const send = async (round: number, body: string) => {
      await writeFile(join(folder!, `body${round}`), body);
      await writeFile(join(folder!, `go${round}`), "");
    };

    const noteOf = async (body: string) => (await app.rpc("message.list", { to: agent.id, status: null })).find((message) => message.body === body);

    // ask-first: held, drawn with the Door's Rail name, Allow and ×; nothing is typed until Allow.
    await app.rpc("route.set", { from: workstream.id, to: agent.id, delivery: "ask-first" });
    await send(1, "ask first note");

    const queue = await screen.findByRole("region", { name: "Note to Ann" });

    const row = await waitFor(() => {
      const found = queue.querySelector<HTMLElement>("[data-note]");

      expect(found?.textContent).toContain("ask first note");

      return found!;
    }, { timeout: 30_000 });

    expect(within(row).getByText("Crew")).toBeTruthy();
    expect(within(row).getByRole("button", { name: "Remove note: ask first note" })).toBeTruthy();
    expect(await noteOf("ask first note")).toMatchObject({ status: "held", reason: "ask-first", from: { kind: "agent", id: workstream.id } });
    expect(await typed("ask first note")).toEqual([]);

    fireEvent.click(within(row).getByRole("button", { name: "Allow" }));
    await waitFor(async () => expect((await noteOf("ask first note"))?.status).toBe("delivered"), { timeout: 30_000 });
    await waitFor(async () => expect(await typed("ask first note")).toHaveLength(1), { timeout: 30_000 });
    expect(calls.mock.calls.filter(([method]) => method === "message.deliver")).toHaveLength(1);
    expect(calls.mock.calls.filter(([method]) => method === "message.deliver")[0]![1]).toEqual({ id: (await noteOf("ask first note"))!.id });
    await waitFor(async () => expect(await status(agent.id)).toBe("idle"), { timeout: 30_000 });

    // auto: delivered with no row.
    await app.rpc("route.set", { from: workstream.id, to: agent.id, delivery: "auto" });
    await send(2, "auto note");
    await waitFor(async () => expect((await noteOf("auto note"))?.status).toBe("delivered"), { timeout: 30_000 });
    await waitFor(async () => expect(await typed("auto note")).toHaveLength(1), { timeout: 30_000 });
    await waitFor(async () => expect(await status(agent.id)).toBe("idle"), { timeout: 30_000 });

    // drop: dropped with no row and nothing typed.
    await app.rpc("route.set", { from: workstream.id, to: agent.id, delivery: "drop" });
    await send(3, "dropped note");
    await waitFor(async () => expect((await noteOf("dropped note"))?.status).toBe("dropped"), { timeout: 30_000 });

    watch.disconnect();
    expect(seen.has("ask first note")).toBe(true);
    expect([...seen].some((text) => text.includes("auto note") || text.includes("dropped note"))).toBe(false);
    expect(await typed("dropped note")).toEqual([]);
    expect(calls.mock.calls.filter(([method]) => method === "message.deliver")).toHaveLength(1);
  }, 240_000);
});
