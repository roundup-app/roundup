import { afterAll, beforeAll, expect, it } from "vitest";
import { openLane, type LaneBrowser } from "../todos/laneBrowser";
import { captureDir } from "../testing/captures";
import { startAppServer } from "../testing/appServer";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

let lane: LaneBrowser;

let headUrl: string;

const ids = ["U4687a", "U4687b", "U4687c", "U4687d"];

beforeAll(async () => { if (captureDir("U4687a")) { lane = await openLane(1512, "dark", "u4687"); headUrl = await lane.evaluate<string>("location.href"); } }, 60_000);

afterAll(async () => { await lane?.close(); }, 60_000);

it.skipIf(!captureDir("U4687a"))("u4687a_rendered_controls_and_preview", async () => {
  const dir = captureDir("U4687a")!;
  mkdirSync(dir, { recursive: true });

  for (const id of ids) mkdirSync(join(captureDir(id)!, "1512x950-dark-head"), { recursive: true });
  const url = await lane.evaluate<string>("location.href");
  await lane.browser("record", "start", join(dir, "settings.webm"));
  await lane.browser("open", url);
  await lane.browser("set", "media", "dark");
  await lane.until("!!document.querySelector('.shelf-tabs')");

  let recording = true;

  try {
    await lane.evaluate("window.dispatchEvent(new Event('open-app-settings'))");
    await lane.until("!!document.querySelector('.settings-sections')");
    await lane.browser("click", "[role=tab][data-value=Appearance]");

    for (const id of ids) await lane.capture(id, "head/appearance");
    await lane.browser("click", "[data-scope=segment-group][data-part=item][aria-label=Large]");
    await lane.until("document.documentElement.dataset.interfaceScale === 'large'");
    await lane.capture("U4687a", "head/scale-large");
    await lane.browser("click", "[data-scope=segment-group][data-part=item][aria-label=Small]");
    await lane.until("document.documentElement.dataset.interfaceScale === 'small'");
    await lane.capture("U4687a", "head/scale-small");
    await lane.browser("click", "[data-scope=segment-group][data-part=item][aria-label=Default]");
    await lane.browser("click", "[role=switch]");
    await lane.until("document.documentElement.dataset.focusMarkers === 'false'");
    await lane.capture("U4687d", "head/marker-off");
    await lane.browser("click", "[role=switch]");
    await lane.browser("click", "[role=tab][data-value=Terminal]");
    await lane.until("!!document.querySelector('.settings-preview .xterm')");

    for (const id of ids) await lane.capture(id, "head/terminal");
    await lane.browser("record", "stop");
    recording = false;
    const calls = await lane.calls();
    await lane.browser("fill", "input[aria-label='Line height']", "1");
    await lane.capture("U4687b", "head/line-min-draft");
    await lane.browser("fill", "input[aria-label='Line height']", "2");
    await lane.browser("press", "Enter");
    await lane.capture("U4687b", "head/line-max");
    await lane.browser("fill", "input[aria-label='Letter spacing']", "3");
    await lane.browser("press", "Enter");
    await lane.capture("U4687a", "head/spacing-max");
    await lane.browser("fill", "input[aria-label='Font size']", "21");
    await lane.browser("press", "Enter");
    await lane.capture("U4687c", "head/size-max");
    await lane.browser("fill", "input[aria-label='Font size']", "9");
    await lane.browser("press", "Enter");
    await lane.capture("U4687c", "head/size-min");
    await lane.browser("fill", "input[aria-label='Font size']", "invalid");
    await lane.browser("press", "Enter");
    await lane.until("document.body.textContent.includes('Choose a font size')");
    await lane.capture("U4687a", "head/refused");
    expect((await lane.calls()).slice(calls.length).filter(call => call.method === "terminal.create" || call.method === "terminal.write")).toEqual([]);
  } finally { if (recording) await lane.browser("record", "stop"); }
}, 60_000);

it.skipIf(!captureDir("U4687a") || !process.env.ROUNDUP_SETTINGS_BASE)("u4687c_paired_baseline_at_the_same_viewport", async () => {
  const root = process.env.ROUNDUP_SETTINGS_BASE;

  if (!root) throw new Error("Set ROUNDUP_SETTINGS_BASE to the baseline desktop directory.");
  const server = await startAppServer({ root });

  try {
    for (const seed of ["first-run", "agents-10", "tree-40"]) {
      await lane.browser("open", server.resolvedUrls.local[0] + "harness.html?seed=" + seed);
      await lane.browser("set", "media", "dark");
      await lane.until("(() => { window.dispatchEvent(new Event('open-app-settings')); return !!document.querySelector('.settings-sections'); })()");

      for (const section of ["Appearance", "Terminal"]) {
        await lane.browser("click", "[role=tab][data-value=" + section + "]");

        for (const id of ids) {
          const dir = join(captureDir(id)!, "base");
          mkdirSync(dir, { recursive: true });
          writeFileSync(join(dir, seed + "-" + section + ".checks.json"), JSON.stringify(await lane.evaluate("window.__checks()")));
          await lane.browser("screenshot", join(dir, seed + "-" + section + ".png"));
        }
      }
    }
  } finally { await server.close(); }
}, 60_000);

it.skipIf(!captureDir("U4687a"))("u4687a_controls_without_a_project_and_with_agents", async () => {
  for (const seed of ["first-run", "agents-10"]) {
    await lane.browser("open", headUrl.replace("seed=tree-40", "seed=" + seed));
    await lane.browser("set", "media", "dark");
    await lane.until("(() => { window.dispatchEvent(new Event('open-app-settings')); return !!document.querySelector('.settings-sections'); })()");

    for (const section of ["Appearance", "Terminal"]) {
      await lane.browser("click", "[role=tab][data-value=" + section + "]");

      if (section === "Terminal") await lane.until("!!document.querySelector('.settings-preview .xterm')");

      for (const id of ids) await lane.capture(id, "head/" + seed + "-" + section);
    }
  }

  expect((await lane.calls()).filter(call => call.method === "agent.spawn")).toEqual([]);
}, 60_000);

it.skipIf(!captureDir("U4687a"))("u4687b_rendered_family_and_weight_choices", async () => {
  await lane.browser("open", headUrl);
  await lane.browser("set", "media", "dark");
  await lane.until("(() => { window.dispatchEvent(new Event('open-app-settings')); return !!document.querySelector('.settings-sections'); })()");
  await lane.browser("click", "[role=tab][data-value=Terminal]");
  await lane.until("!!document.querySelector('.settings-preview .xterm')");

  for (const weight of [300, 400, 500, 600]) {
    await lane.browser("click", "[data-scope=segment-group][data-part=item][aria-label='" + weight + "']");
    await lane.capture("U4687b", "head/weight-" + weight);
  }

  for (const family of ["Fira Code", "Menlo", "Monaco", "monospace", "Default"]) {
    await lane.browser("click", "[role=combobox][aria-label='Font family']");
    await lane.browser("find", "role", "option", "click", "--name", family, "--exact");
    await lane.capture("U4687b", "head/family-" + family.replaceAll(" ", "-"));
  }

  expect((await lane.calls()).filter(call => call.method === "terminal.write")).toEqual([]);
}, 60_000);
