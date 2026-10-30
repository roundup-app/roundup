import { mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { appServer } from "../testing/appServer";
import type { Checks } from "../testing/checks";
import { captureDir } from "../testing/captures";
import { it, expect } from "vitest";
import { openLane } from "../todos/laneBrowser";

it("u4688b_rendered_naming_typing_and_recovery", async () => {
  const lane = await openLane(1512, "dark", "builder-4688");
  const base = process.env.ROUNDUP_NAMING_BASE;
  const server = base ? await appServer({ root: join(base, "apps/desktop") }) : null;
  const origin = server?.resolvedUrls.local[0] ?? await lane.evaluate<string>("location.origin");

  const capture = async (id: string, seed: string, step: string) => {
    const root = captureDir(id);

    if (!root) return;
    const dir = join(root, base ? "base" : "head");
    mkdirSync(dir, { recursive: true });
    const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: base ?? process.cwd(), encoding: "utf8" }).trim();
    writeFileSync(join(dir, `${seed}-${step}.checks.json`), JSON.stringify({ sha, seed, renderer: "Chromium", viewport: [1512,950], scheme:"dark", ...await lane.evaluate<Checks>("window.__checks()") }) + "\n");
    await lane.browser("screenshot", join(dir, `${seed}-${step}.png`));
  };

  const videoRoot = captureDir("U4688b");

  if (videoRoot) {
    const dir = join(videoRoot, base ? "base" : "head");
    mkdirSync(dir, { recursive: true });
    await lane.browser("record", "start", join(dir, "settings.webm"));
    await lane.browser("set", "media", "dark");
  }

  try {
    for (const seed of ["first-run", "agents-10", "tree-40"]) {
      await lane.browser("open", `${origin}/harness.html?seed=${seed}`);
      await lane.until("!!window.__fake && !!document.querySelector('.window')");
      await lane.browser("set", "media", "dark");
      await lane.evaluate("window.dispatchEvent(new Event('open-app-settings'))");
      await lane.until("!!document.querySelector('.settings-view')");

      if (base) {
        await capture("U4688a", seed, "controls");
        await capture("U4688b", seed, "controls");
        continue;
      }

      await lane.until("!!document.querySelector('.settings-naming textarea')");
      await capture("U4688a", seed, "controls");
      await capture("U4688b", seed, "controls");
      await lane.browser("click", ".app-switch-label");
      await lane.until("document.querySelector('[role=switch]').getAttribute('aria-checked') === 'false'");
      await lane.browser("focus", "[role=switch]");
      await lane.browser("press", "Space");
      await lane.until("document.querySelector('[role=switch]').getAttribute('aria-checked') === 'true'");
      await lane.browser("focus", ".settings-naming textarea");
      await lane.evaluate(`(() => {
        window.__namingMutations = [];
        window.__namingObserver = new MutationObserver(records => window.__namingMutations.push(...records.filter(record => !record.target.closest?.('.settings-naming textarea')).map(record => record.type)));
        window.__namingObserver.observe(document.querySelector('.settings-view'), {subtree:true, childList:true, characterData:true});
        return true;
      })()`);
      await lane.browser("fill", ".settings-naming textarea", "役割\n動作-対象  twenty characters");
      await lane.until("JSON.parse(localStorage.getItem('roundup:drafts:naming-settings')).drafts.at(-1).value.text.includes('twenty characters')");
      expect(await lane.evaluate("window.__namingMutations")).toEqual([]);
      await lane.evaluate("window.__namingObserver.disconnect()");
      await lane.browser("click", ".settings-back");
      await lane.evaluate("window.dispatchEvent(new Event('open-app-settings'))");
      await lane.until("document.querySelector('.settings-naming textarea')?.value.includes('twenty characters')");
      await lane.evaluate(`(() => {window.__fake.app.handlers['daemon.setNaming'] = () => {throw new Error('Naming settings could not be saved: disk full. Free space, then Save to retry.');}; return true;})()`);
      await lane.browser("click", ".settings-naming button");
      await lane.until("document.querySelector('.settings-naming [data-part=error-text]')?.textContent.includes('disk full')");
      await capture("U4688b", seed, "failure");
      await lane.evaluate("(() => {window.__fake.app.handlers['daemon.setNaming'] = () => null; return true;})()");
      await lane.browser("click", ".settings-naming button");
      await lane.until("JSON.parse(localStorage.getItem('roundup:drafts:naming-settings')).drafts.length === 0");
      await capture("U4688b", seed, "saved");
    }
  } finally {
    try { if (videoRoot) await lane.browser("record", "stop"); }
    finally { await lane.close(); await server?.close(); }
  }
}, 120_000);
