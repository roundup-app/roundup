import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { chromePath, openPage } from "./chromePage";
import type { ChromePage } from "./chromePage";

/** U372 in a real Chromium: D12 to D14 hold in the Shelf overlay. */

const found = chromePath();

// A missing browser skips only off CI: on CI the claim must be checked, never silently dropped.
const run = found || process.env["CI"] ? describe : describe.skip;

let page: ChromePage;

beforeAll(async () => {
  if (!found) throw new Error("U369 needs a Chrome binary: set CHROME_PATH");

  page = await openPage(found);
}, 90_000);

// The Shelf's open state persists in storage: a test that closes it must not close it for the next.
afterEach(async () => {
  await page.call(`() => localStorage.clear()`);
});

afterAll(async () => {
  await page?.close();
});

const load = async (width: number, height: number) => {
  await page.load("/harness.html?seed=tree-40", width, height);
  await page.until(`() => Boolean(window.__fake) && document.querySelector(".shelf") !== null`);
  // The Shelf slides in: wait until its leading edge has stopped.
  await page.until(`() => { const left = document.querySelector(".shelf").getBoundingClientRect().left; const same = window.__last === left; window.__last = left; return same && left < window.innerWidth; }`);
};

run("u372 the Shelf's text", () => {
  it("u372_d12_d13_d14_hold_in_the_overlay", async () => {
    await load(1280, 820);
    await page.call(`async () => {
      const app = window.__fake.app;
      window.__fake.actAs({ kind: "agent", id: "agent-1", parent: null });
      await app.rpc("todo.create", { title: "w".repeat(300), body: null, blockers: null });
      const blockers = [];
      for (let n = 0; n < 10; n++) blockers.push((await app.rpc("todo.create", { title: "blocker " + n, body: null, blockers: null })).id);
      await app.rpc("todo.create", { title: "blocked by ten", body: null, blockers });
      const home = await app.rpc("rail.createWorkstream", { name: "h".repeat(60), parent: null });
      const homed = await app.rpc("todo.create", { title: "homed in a long workstream", body: null, blockers: null });
      await app.rpc("todo.move", { id: homed.id, home: home.id });
      await app.rpc("pad.create", { name: "p".repeat(120), text: null });
      await new Promise((done) => setTimeout(done, 400));
    }`);
    await page.call(`async () => {
      [...document.querySelectorAll('.shelf [role="tab"]')].find((tab) => tab.textContent.toLowerCase().startsWith("pads")).click();
      await new Promise((done) => setTimeout(done, 300));
    }`);
    const checks = await page.call<string>(`async () => JSON.stringify(await window.__checks())`);
    const parsed: Record<string, { status: string }> = JSON.parse(checks);

    for (const id of ["D12", "D13", "D14"]) expect(parsed[id], id).toMatchObject({ status: "pass" });
  });
});
