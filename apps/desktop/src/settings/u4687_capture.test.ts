import { afterAll, beforeAll, expect, it } from "vitest";
import { openLane, type LaneBrowser } from "../todos/laneBrowser";
import { captureDir } from "../testing/captures";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

let lane: LaneBrowser;

const ids = ["U4687a", "U4687b", "U4687c", "U4687d"];

beforeAll(async () => { if (captureDir("U4687a")) lane = await openLane(1512, "dark", "u4687"); }, 60_000);

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
  } finally { await lane.browser("record", "stop"); }
}, 60_000);
