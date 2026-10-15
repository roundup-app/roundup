import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { captureDir } from "../testing/captures";
import { CHECK_IDS, type Checks } from "../testing/checks";
import { action, browser, click, load, read, selected, url, wait } from "./tabsBrowser";

const art = captureDir("U500");

for (const width of [1280, 1440]) for (const scheme of ["light", "dark"]) {
  it(`u500_rendered_checks ${width} ${scheme}`, async () => {
    await browser("set", "viewport", String(width), "800");
    await browser("set", "media", scheme);
    const baseline = new Map<string, Checks>();

    const capture = async (side: string, step: string) => {
      const checks = await read<Checks>("window.__checks()");

      if (side === "base") baseline.set(step, checks);
      else {
        for (const id of CHECK_IDS) if (baseline.get(step)![id].status === "pass") expect(checks[id].status, `${step} ${id}`).toBe("pass");

        for (const id of ["D2", "D5", "D6"] as const) expect(checks[id], `${step} ${id}`).toMatchObject({ status: "pass" });
      }

      if (art) {
        const directory = join(art, side);

        mkdirSync(directory, { recursive: true });
        const name = `${width}-${scheme}-${step}`;

        await browser("screenshot", join(directory, `${name}.png`));
        writeFileSync(join(directory, `${name}.checks.json`), JSON.stringify(checks));
      }
    };

    for (const side of ["base", "head"]) {
      await load(side === "base" ? "?base" : "");
      await capture(side, "initial");
      await browser("hover", '[role="tab"][data-value="pads"]');
      await capture(side, "hover");
      await click("button", "Before");
      await action("press", "Tab");
      await selected("Todos", true);
      await capture(side, "focus");
      await action("press", "ArrowRight");
      await selected("Pads", true);
      await capture(side, "switched");
      await browser("open", url("/harness.html?seed=tree-40"));
      await wait(`!!window.__fake && document.querySelectorAll('.rail-row').length > 2`);
      await browser("eval", `window.__fake.app.closeProject = async () => { throw new Error('could not stop rupd'); }`);
      await browser("hover", ".project-tab");
      await browser("eval", `(() => { const opener = document.querySelector('[aria-label^="Close "]'); opener.focus(); opener.click(); })()`);
      await wait(`document.activeElement?.textContent === 'Cancel'`);
      await browser("find", "role", "button", "click", "--name", "Stop and close", "--exact");
      await wait(`document.body.textContent.includes('could not stop rupd')`);
      await capture(side, "failure");
    }
  }, 120_000);
}
