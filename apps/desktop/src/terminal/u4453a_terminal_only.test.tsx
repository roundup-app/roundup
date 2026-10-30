import { copy } from "./copy";
import { door } from "../testing/nodes";
import { cleanup, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { mountNavigation } from "../testing/navigationFixture";

afterEach(() => { cleanup(); localStorage.clear(); sessionStorage.clear(); });

it.each(["agent", "door", "workstream"])("u4453a_agent_view_mounts_only_the_terminal: %s", async kind => {
  const { connected, nodes, emulators } = await mountNavigation();
  nodes.find(node => node.id === "a0")!.work = { kind: "work", ask: "Walk the user through the release", limits: ["Keep drafts"] };
  nodes.push(door("running", "working", "Working"));
  await connected().rail.refresh();
  connected().rail.select(kind === "agent" ? "a0" : kind === "door" ? "running" : "home");
  await waitFor(() => expect(connected().rail.selected()).not.toBeNull());

  const centre = screen.getByRole("region", { name: "Centre" });
  const id = kind === "agent" ? "t-a0" : kind === "door" ? "t-running" : "t-home";

  if (kind !== "workstream") expect(centre.contains(emulators.made.get(id)!.host)).toBe(true);

  expect(within(centre).queryByRole("navigation")).toBeNull();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(within(centre).queryByRole("button", { name: /Order of|Edit order/ })).toBeNull();
  expect(within(centre).queryByLabelText(/Full order/)).toBeNull();

  expect(within(centre).queryByRole("button", { name: /Remove note:/ })).toBeNull();
  expect(within(centre).queryByRole("textbox", { name: copy.askBarLabel })).toBeNull();
});

it.skipIf(!process.env.ROUNDUP_CAPTURES?.includes("U4453a"))("u4453a_rendered_terminal_only", async () => {
  const { mkdirSync, writeFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { captureDir } = await import("../testing/captures");
  const { openLane } = await import("../todos/laneBrowser");
  const { startAppServer } = await import("../testing/appServer");
  const baseline = process.env.ROUNDUP_BASELINE_ROOT ? await startAppServer({ root: process.env.ROUNDUP_BASELINE_ROOT }) : null;
  const page = await openLane(1512, "dark", "u4453");
  const origin = await page.evaluate<string>("location.origin");

  try {
    for (const [side, url] of [...(baseline ? [["base", baseline.resolvedUrls.local[0]]] : []), ["head", origin]]) {
      for (const seed of ["agents-10", "door-stopped", "tree-40", "empty-project"]) {
        await page.evaluate("localStorage.clear()");
        await page.browser("open", new URL(`/harness.html?seed=${seed}`, url).href);
        await page.until("!!window.__fake && !!document.querySelector('.todo-project-root')");

        if (seed !== "empty-project") {
          await page.evaluate("(async () => { const id = document.querySelector('.rail-row[data-id]').dataset.id; await window.__fake.app.rpc('rail.rename', {id, name: 'An Agent with a sixty character name to test the full Rail width'}); return true; })()");
          await page.browser("click", ".rail-row[data-id]");
          await page.until("!!document.querySelector('.pane-screen')");
        }

        await page.evaluate("document.fonts.ready.then(() => true)");

        for (const id of ["U4453a", "U4453b"]) {
          const output = join(captureDir(id)!, side!);
          mkdirSync(output, { recursive: true });
          writeFileSync(join(output, `${seed}.checks.json`), JSON.stringify(await page.evaluate("window.__checks()")) + "\n");
          await page.browser("screenshot", join(output, `${seed}.png`));
        }

        if (side === "head" && seed !== "empty-project") {
          await page.browser("press", "Meta+k");
          await page.until("!!document.querySelector('.hint-line.leader')");
          await page.browser("press", "a");
          await page.until("!!document.querySelector('.ask-input')");
          await page.capture("U4453b", `${seed}-returned`);
        }
      }
    }
  } finally {
    await page.close();
    await baseline?.close();
  }
}, 180_000);
