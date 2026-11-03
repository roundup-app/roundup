import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { shelfBrowser } from "../shelf/u371Browser";
import { captureDir } from "../testing/captures";
import type { Checks } from "../testing/checks";

const { rig, browser, evaluate, settle, openShelf } = shelfBrowser();

const title = "Review findings ".repeat(13).slice(0, 200);

const source = 'before **word** after\n\n<mark><span data-pad-color="blue">Existing finding</span></mark>\n\n' + Array.from({ length: 80 }, (_, i) => `Review paragraph ${i + 1}. Keep the recorded evidence and the next action together.\n\n`).join("");

const triggerSelector = 'button[aria-label="Text colour"]';

it("u5808b_colour_palette_capture", { retry: 0, timeout: 180000 }, async () => {
  const directories = ["U5808a", "U5808b"].flatMap(id => { const dir = captureDir(id);

 return dir ? [join(dir, process.env.ROUNDUP_CAPTURE_PHASE ?? "head")] : []; });

  for (const dir of directories) mkdirSync(dir, { recursive: true });
  await openShelf("tree-40", 288, 320, 1512, "dark");
  await browser("set", "viewport", "1512", "950");

  if (directories[0]) {
    await browser("record", "start", join(directories[0], "interactions.webm"));
    await browser("open", `${rig.server.resolvedUrls.local[0]}harness.html?view=workstreams&items=1&tabs=1&seed=tree-40`);
    await browser("wait", ".shelf-tabs");
  }

  await browser("set", "media", "dark");
  await browser("wait", "--fn", "innerWidth === 1512 && innerHeight === 950 && matchMedia('(prefers-color-scheme: dark)').matches");
  await evaluate(`(async () => { await window.__fake.app.rpc('pad.create', ${JSON.stringify({ name: title, text: source })}); document.querySelector('#shelf-tab-pads').click(); return true; })()`);
  await browser("wait", "[data-shelf-group=unassigned]");
  await evaluate(`(() => { const group = document.querySelector('[data-shelf-group=unassigned] [data-part=branch-control]'); if (group?.getAttribute('data-state') === 'closed') group.click(); return true; })()`);
  await browser("wait", ".pad-name");
  await evaluate(`(() => { [...document.querySelectorAll('.pad-name')].find(row => row.textContent === ${JSON.stringify(title)}).focus(); return true; })()`);
  await browser("press", "Enter");
  await browser("wait", ".ProseMirror[contenteditable=true]");
  await settle();
  await browser("wait", 'button[aria-label="Text colour"]');
  await browser("click", ".drawer .ProseMirror");
  await evaluate(`(() => { const text = document.querySelector('.drawer .ProseMirror strong').firstChild; window.getSelection().setBaseAndExtent(text, 0, text, 4); return true; })()`);
  await browser("wait", "--fn", "window.getSelection().toString() === 'word'");
  await evaluate(`window.__colourTrigger = document.querySelector('${triggerSelector}'); true`);

  const opening = async (name: string, input: string) => {
    if (input === "pointer") await browser("click", triggerSelector);
    else { await browser("focus", triggerSelector); await browser("press", input); }

    await browser("wait", "--fn", `(() => { const menu = document.querySelector('.pad-colour-menu'); return menu?.dataset.state === 'open' && menu.dataset.placement && getComputedStyle(menu.closest('[data-part=positioner]')).getPropertyValue('--x') && getComputedStyle(menu.closest('[data-part=positioner]')).getPropertyValue('--y') && getComputedStyle(menu).opacity === '1' && !menu.getAnimations().some(a => a.playState === 'running'); })()`);

    const reading = await evaluate<{ checks: Checks }>(`(() => {
      const trigger = document.querySelector('${triggerSelector}');
      const menu = document.querySelector('.pad-colour-menu');
      const positioner = menu.closest('[data-part=positioner]');
      const style = getComputedStyle(positioner);
      const body = document.querySelector('.drawer .pad-editor');
      return { checks: window.__checks(), triggerId: trigger.id, labelledby: menu.getAttribute('aria-labelledby'), controls: trigger.getAttribute('aria-controls'), menuId: menu.id, sameTrigger: trigger === window.__colourTrigger, trigger: trigger.getBoundingClientRect().toJSON(), menu: menu.getBoundingClientRect().toJSON(), placement: menu.dataset.placement, effectiveOffset: 8, offsetSource: "@zag-js/popper 1.45.0 get-placement default gutter; no arrow or override", transformOrigin: style.getPropertyValue('--transform-origin'), transform: style.transform, positionerStyle: positioner.getAttribute('style'), scroll: { top: body.scrollTop, height: body.clientHeight, total: body.scrollHeight }, recovery: document.querySelector('.pad-body [role=alert]')?.textContent ?? null };
    })()`);

    for (const dir of directories) {
      await browser("screenshot", join(dir, `${name}.png`));
      writeFileSync(join(dir, `${name}.checks.json`), JSON.stringify({ ...reading.checks, observation: { ...reading, checks: undefined } }, null, 2));
    }

    await browser("press", "Escape");
    await browser("wait", "--fn", `document.activeElement === window.__colourTrigger && document.querySelector('${triggerSelector}').getAttribute('aria-expanded') === 'false' && !document.querySelector('.pad-colour-menu')`);
  };

  for (const [name, input] of [["keyboard", "Enter"], ["reopen", "Enter"], ["space", "Space"], ["pointer", "pointer"]]) await opening(name!, input!);
  await evaluate(`(() => { const body = document.querySelector('.drawer .pad-editor'); body.scrollTop = body.clientHeight; return true; })()`);
  await settle();
  await opening("scrolled-keyboard", "Enter");
  await opening("scrolled-pointer", "pointer");
  expect(await evaluate("window.__fake.app.calls.filter(call => call.method === 'pad.write').length")).toBe(0);

  await evaluate(`(() => { const editor = document.querySelector('.drawer .ProseMirror'); editor.focus(); const text = editor.querySelector('p').firstChild; window.getSelection().setBaseAndExtent(text, 0, text, 0); return true; })()`);
  await evaluate("window.__fake.failNext(-32000, 'Pad save rejected: disk is full. Free space and retry.'); true");
  await browser("keyboard", "type", "Retained review draft ");
  await browser("click", ".pad-head-name");
  await browser("wait", "--fn", "document.querySelector('.pad-body [role=alert]')?.textContent.includes('Free space and retry.')");
  const writes = await evaluate("window.__fake.app.calls.filter(call => call.method === 'pad.write').length");
  await opening("rejected-save", "Enter");
  expect(await evaluate("window.__fake.app.calls.filter(call => call.method === 'pad.write').length")).toBe(writes);

  for (const dir of directories) writeFileSync(join(dir, "fixture.json"), JSON.stringify({ appSha: process.env.ROUNDUP_CAPTURE_SHA ?? execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), observerHash: createHash("sha256").update(readFileSync(new URL(import.meta.url))).digest("hex"), seed: "tree-40", viewport: [1512, 950], scheme: "dark", title, source }));

  if (directories[0]) await browser("record", "stop");
});
