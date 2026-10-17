import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { CHECK_IDS, type Checks } from "../testing/checks";
import { captureDir } from "../testing/captures";
import { action, browser, click, load, read, selected, url, wait } from "./tabsBrowser";
import { FULLSCREEN } from "../testing/chromePage";

const art = captureDir("U500");

const capture = async (side: string, name: string) => {
  const checks = await read<Checks>("import('/src/testing/checks.ts').then(module => module.runChecks())");

  if (art) {
    const directory = join(art, side);

    mkdirSync(directory, { recursive: true });
    await browser("screenshot", join(directory, `${name}.png`));
    writeFileSync(join(directory, `${name}.checks.json`), JSON.stringify(checks));
  }

  return checks;
};

const noRegression = (base: Checks, head: Checks) => {
  for (const id of CHECK_IDS) if (base[id].status === "pass" || ["D2", "D5", "D6"].includes(id)) expect(head[id].status, `${id}: ${JSON.stringify(head[id])}`).toBe("pass");
};

for (const scheme of ["light", "dark"]) for (const width of [FULLSCREEN.width]) {
  it(`u500_rendered_checks ${scheme}-${width}`, async () => {
    // Captured baselines must be main's styles with raw installed Ark, not the new wrapper.
    if (art) expect(process.env.U500_BASE_ROOT).toBeTruthy();
    await browser("set", "media", scheme);
    await browser("set", "viewport", String(width), "800");
    const baseline: Record<string, Checks> = {};

    for (const side of ["base", "head"]) {
      await load("", side === "base");
      await selected("Todos");

      for (const state of ["initial", "hovered", "focused", "switched"]) {
        if (state === "hovered") await action("find", "role", "tab", "hover", "--name", "Pads ·", "--exact");

        if (state === "focused") {
          await action("mouse", "move", String(width - 20), "700");
          await click("button", "Before");
          await action("press", "Tab");
          await selected("Todos", true);
        }

        if (state === "switched") {
          await action("press", "ArrowRight");
          await selected("Pads", true);
        }

        const checks = await capture(side, `${scheme}-${width}-${state}`);

        if (side === "base") baseline[state] = checks;
        else noRegression(baseline[state]!, checks);
      }

      await browser("open", url("/harness.html?seed=tree-40", side === "base"));
      await wait(`!!window.__fake && document.querySelectorAll('.rail-row').length > 2`);
      await read(`window.__fake.app.closeProject = async () => { throw new Error('could not close project'); }`);
      await browser("hover", ".project-tab");
      await wait(`(() => { const close = document.querySelector('[aria-label^="Close "]'); return close?.checkVisibility() && Number(getComputedStyle(close).opacity) > 0; })()`);
      await browser("click", '[aria-label^="Close "]');
      await wait(`document.activeElement?.textContent === 'Cancel'`);
      await browser("find", "role", "button", "click", "--name", "Stop and close", "--exact");
      await wait(`document.body.textContent.includes('could not close project')`);
      expect(await read<boolean>(`[...document.querySelectorAll('*')].some(el => el.textContent === 'could not close project' && el.checkVisibility())`)).toBe(true);
      const checks = await capture(side, `${scheme}-${width}-tree-40-failure`);

      if (side === "base") baseline.failure = checks;
      else noRegression(baseline.failure!, checks);
    }
  }, 120_000);
}
