// @vitest-environment jsdom
import { spawn } from "node:child_process";
import { join, resolve } from "node:path";
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { App } from "../App";
import type { AppSeam } from "../app/seam";
import { fakeEmulators } from "../terminal/paneHarness";
import { createServedApp } from "./realSeam";
import { startRealDaemon } from "./realDaemonFixture";
import type { StartedDaemon } from "./realDaemonFixture";

let real: StartedDaemon;

beforeAll(async () => {
  real = await startRealDaemon({
    FAKE_CLAUDE_ON_PROMPT: JSON.stringify({ name: "pad_write", arguments: { name: "$pad", text: "done $prompt" } }),
  });
}, 120_000);

afterAll(async () => {
  await real?.stop();
});

afterEach(cleanup);

window.matchMedia ??= (query) => ({ ...new EventTarget(), matches: false, media: query, onchange: null, addListener: () => undefined, removeListener: () => undefined });

// jsdom has no layout; ProseMirror asks a Range for its rectangles when a selection moves.
Range.prototype.getClientRects ??= () => document.body.getClientRects();

Range.prototype.getBoundingClientRect ??= () => new DOMRect();

/** One tool call of `rup mcp <agent>`, as that Agent makes it: its text, or `isError` with its text. */
const callAs = (agent: string, name: string, args: { name: string; text: string }) =>
  new Promise<{ isError: boolean; text: string }>((done, fail) => {
    const rup = join(resolve(process.cwd(), "../.."), "target/debug/rup");
    const child = spawn(rup, ["mcp", agent], { env: { ...process.env, RUPD_SOCKET: join(real.dir, "rupd.sock") }, stdio: ["pipe", "pipe", "inherit"] });

    const frames = [
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "u188", version: "0" } } },
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name, arguments: args } },
    ];

    let pending = "";

    child.on("error", fail);

    child.stdout.on("data", (chunk: Buffer) => {
      pending += chunk.toString();

      for (let end = pending.indexOf("\n"); end >= 0; end = pending.indexOf("\n")) {
        // SAFETY: `rup mcp` answers each request with one JSON-RPC line of this shape.
        const reply = JSON.parse(pending.slice(0, end)) as { id?: number; result?: { isError?: boolean; content: { text: string }[] } };

        pending = pending.slice(end + 1);

        if (reply.id === 2) {
          child.kill();
          done({ isError: reply.result?.isError === true, text: reply.result?.content[0]?.text ?? "" });
        }
      }
    });

    child.stdin.write(frames.map((frame) => `${JSON.stringify(frame)}\n`).join(""));
  });

const scribeOf = async (app: AppSeam, name: string) => (await app.rpc("pad.read", { name })).scribe;

describe("u188 a Pad's Scribe answers and edits on the real Daemon", () => {
  it("u188_each_pad_has_one_scribe_that_writes_its_pad_and_no_other", async () => {
    const app: AppSeam = createServedApp(real.base);
    const owner = await app.rpc("agent.spawn", { cwd: real.dir, prompt: null, parent: null });

    await app.rpc("pad.create", { name: "notes", text: "long" });
    expect((await callAs(owner.id, "pad_create", { name: "plan", text: "long" })).isError).toBe(false);

    render(() => <App app={app} reducedMotion={() => true} clock={Date.now} createEmulator={fakeEmulators().factory} />);

    const ask = async (name: string, text: string) => {
      const field = await screen.findByLabelText<HTMLInputElement>("Ask or edit this pad");

      fireEvent.input(field, { target: { value: text } });
      fireEvent.click(screen.getByRole("button", { name: "send" }));
      await waitFor(() => expect(field.value).toBe(""), { timeout: 30_000 });

      return scribeOf(app, name);
    };

    const scribes: Record<string, string> = {};

    for (const name of ["notes", "plan"]) {
      // The Shelf lists Pads no Agent on the Rail owns; an Agent's Pad opens from under its row (U58).
      if (name === "plan") fireEvent.click(await screen.findByRole("button", { name: "1 pads" }));

      fireEvent.click(await screen.findByText(name));
      await screen.findByRole("textbox", { name: "Pad body" });

      scribes[name] = (await ask(name, "shorten"))!;
      expect(scribes[name]).toBeTruthy();

      await waitFor(() => expect(screen.getByRole("textbox", { name: "Pad body" }).textContent).toContain("done shorten"), { timeout: 30_000 });
      expect((await app.rpc("pad.read", { name })).text).toBe("done shorten");
      expect(screen.getByLabelText("exchange").textContent).toContain("shorten");
      expect((await app.rpc("message.list", { to: scribes[name]!, status: null })).map((message) => message.status)).toEqual(["delivered"]);

      const history = await app.rpc("provenance.history", { item: `pad:${name}` });

      expect(history.some((touch) => touch.verb === "wrote" && touch.actor.kind === "agent" && touch.actor.id === scribes[name])).toBe(true);

      // The last-touch line names the Scribe, not `you`.
      await waitFor(() => expect(screen.getByText(/ wrote this pad at /).textContent).toMatch(/^(?!you )\S.* wrote this pad at /));

      // A second ask starts no second Scribe.
      const before = (await app.rpc("rail.tree", null)).length;

      expect(await ask(name, "again")).toBe(scribes[name]);
      expect((await app.rpc("rail.tree", null)).length).toBe(before);

      fireEvent.click(screen.getByRole("button", { name: "close" }));
      await waitFor(() => expect(screen.queryByLabelText("Ask or edit this pad")).toBeNull());

      // Closing the Drawer with the Scribe idle stops it (U190).
      await waitFor(async () => {
        const node = (await app.rpc("rail.tree", null)).find((candidate) => candidate.id === scribes[name]);

        expect(node?.status?.kind).not.toBe("idle");
      }, { timeout: 30_000 });
    }

    expect(scribes.notes).not.toBe(scribes.plan);

    // P11: a Scribe's `pad_write` on the other Pad is FORBIDDEN, and the Pad is unchanged.
    const refused = await callAs(scribes.notes!, "pad_write", { name: "plan", text: "hijack" });

    expect(refused.isError).toBe(true);
    expect(JSON.parse(refused.text).code).toBe(-32002); // FORBIDDEN
    await waitFor(async () => expect((await app.rpc("pad.read", { name: "plan" })).text).toBe("done again"));
  }, 240_000);

  it("u188_a_reopen_of_the_project_finds_the_exchange", async () => {
    await real.restart();

    const app: AppSeam = createServedApp(real.base);

    render(() => <App app={app} reducedMotion={() => true} clock={Date.now} createEmulator={fakeEmulators().factory} />);
    fireEvent.click(await screen.findByText("notes"));

    const exchange = await screen.findByLabelText("exchange");

    await waitFor(() => expect(exchange.textContent).toContain("shorten"));
    expect(exchange.textContent).toContain("again");
  }, 120_000);
});
