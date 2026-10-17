import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { CHECK_IDS, type Checks } from "../testing/checks";
import { captureDir } from "../testing/captures";
import { browser, read, url, wait } from "../ui/tabsBrowser";

const open = async (seed: string, base = false) => {
  await browser("open", url(`/harness.html?seed=${seed}`, base));
  await wait(`!!window.__fake && document.querySelectorAll('button').length > 2`);
};

const FAILURE = "could not close project\ndetails of the failure\nlast line";

// The close confirmation rejects with a multiline message, which the shared failure line renders.
const failClose = async () => {
  await read(`window.__fake.app.closeProject = async () => { throw new Error(${JSON.stringify(FAILURE)}); }`);
  await browser("hover", ".project-tab");
  await wait(`(() => { const close = document.querySelector('[aria-label^="Close "]'); return close?.checkVisibility() && Number(getComputedStyle(close).opacity) > 0; })()`);
  await browser("click", '[aria-label^="Close "]');
  await wait(`document.activeElement?.textContent === 'Cancel'`);
  await browser("find", "role", "button", "click", "--name", "Stop and close", "--exact");
  await wait(`document.querySelector('[role=alert]')?.textContent.includes('could not close project')`);
};

it("u501_controls_have_names", async () => {
  for (const seed of ["tree-40", "decisions", "bubbles", "resources"]) {
    await open(seed);

    if (seed === "bubbles") await browser("click", '[data-id="runner"]');

    await wait(`document.querySelector('.bubbles, .rail') !== null`);

    const names = await read<{ named: string[]; unnamed: number; titled: number }>(`(() => {
      const icon = [...document.querySelectorAll('.bubbles button, .toasts button, .decision-card button, .resource-strip button')].filter(button => button.checkVisibility() && !button.textContent.trim().replace(/[·\\s]/g, ''));

      return { named: icon.map(button => button.getAttribute('aria-label') ?? '').filter(Boolean), unnamed: icon.filter(button => !button.getAttribute('aria-label')).length, titled: document.querySelectorAll('.ink[title], .resource-value[title], .terminal-tab-pair [title], .ask [title], .toasts [title], [class*=resize] [title]').length };
    })()`);

    expect(names.unnamed, seed).toBe(0);
    expect(names.titled, seed).toBe(0);

    // Hover shows the shared Tooltip with the name; moving away hides it.
    const [first] = names.named;

    if (!first) continue;

    await browser("hover", `button[aria-label="${first}"]`);
    await wait(`document.querySelector('.app-tooltip')?.textContent === ${JSON.stringify(first)}`);
    await browser("mouse", "move", "1", "1");
    await wait(`!document.querySelector('.app-tooltip')`);

    // Keyboard focus shows it too.
    await browser("press", "Tab");
    await browser("focus", `button[aria-label="${first}"]`);
    await wait(`document.querySelector('.app-tooltip')?.textContent === ${JSON.stringify(first)}`);
  }
}, 180_000);

it("u501_full_content_is_available", async () => {
  await open("tree-40");
  await failClose();
  expect(await read<string>(`document.querySelector('[role=alert]').textContent`)).toBe("could not close project");
  expect(await read<boolean>(`document.querySelector('[role=alert]').hasAttribute('title')`)).toBe(false);
  await browser("hover", "[role=alert]");
  await wait(`document.querySelector('.app-tooltip')?.textContent === ${JSON.stringify(FAILURE)}`);
  await browser("mouse", "move", "1", "1");
  await wait(`!document.querySelector('.app-tooltip')`);

  for (let i = 0; i < 12 && !(await read<boolean>(`document.activeElement?.matches("[role=alert]") === true`)); i++) await browser("press", "Tab");
  await wait(`document.querySelector('.app-tooltip')?.textContent === ${JSON.stringify(FAILURE)}`);

  await open("resources");
  await browser("click", '[data-id="worktree-agent"]');
  await wait(`document.querySelectorAll('.resource-value').length === 3`);
  await browser("hover", ".resource-value");
  await wait(`document.querySelector('.app-tooltip')?.textContent === document.querySelector('.resource-name').textContent`);
}, 120_000);

// The Rail's run count (`rail/`, outside this lane) fails D5 in light on main itself; paired runs compare it, a head-only run skips it.
const FOREIGN = ["span.runs"];

// D2, D5 and D6 pass at head unless main already fails the same selector.
const noRegression = (base: Checks | undefined, head: Checks) => {
  for (const id of CHECK_IDS) {
    const failing = JSON.stringify(head[id]);
    const same = base ? base[id].status === "fail" && JSON.stringify(base[id]) === failing : FOREIGN.some((selector) => failing.includes(`"selector":"${selector}"`));

    if (base?.[id].status === "pass" || (["D2", "D5", "D6"].includes(id) && !same)) expect(head[id].status, `${id}: ${JSON.stringify(head[id])}`).toBe("pass");
  }
};

const SURFACES = [
  ["tree-40", "tree-40", failClose],
  ["agents-10", "agents-10", async () => {}],
  ["decisions", "decision", async () => {}],
  ["bubbles", "bubble", async () => {}],
  ["resources", "resources", async () => { await browser("click", '[data-id="worktree-agent"]'); await wait(`document.querySelectorAll('.resource-value').length === 3`); }],
] as const;

const contrast = process.env.PROVIDERS_CONTRAST === "more";

for (const scheme of ["light", "dark"]) for (const width of [1280, 1440]) {
  it(`u493_rendered_checks ${scheme}-${width}-${contrast}`, async () => {
    const art = captureDir("U493");

    if (art) expect(process.env.U500_BASE_ROOT).toBeTruthy();
    await browser("set", "media", scheme);
    await browser("set", "viewport", String(width), "800");

    const baseline: Record<string, Checks> = {};

    for (const side of process.env.U500_BASE_ROOT ? ["base", "head"] : ["head"]) {
      for (const [seed, label, reveal] of SURFACES) {
        await open(seed, side === "base");
        expect(await read<boolean>(`matchMedia("(prefers-contrast: more)").matches`)).toBe(contrast);

        if (seed === "bubbles") await browser("click", '[data-id="runner"]').catch(() => {});

        for (const state of ["initial", "revealed", "focus"]) {
          if (state === "revealed") await reveal();

          if (state === "focus") await browser("press", "Tab");

          const checks = await read<Checks>(`import('/src/testing/checks.ts').then(module => module.runChecks())`);
          const name = `${scheme}-${width}-${contrast}-${label}-${state}`;

          if (art) {
            const directory = join(art, side);

            mkdirSync(directory, { recursive: true });
            await browser("screenshot", join(directory, `${name}.png`));
            writeFileSync(join(directory, `${name}.checks.json`), JSON.stringify(checks));
          }

          if (side === "base") baseline[name] = checks;
          else noRegression(baseline[name], checks);
        }
      }
    }
  }, 240_000);
}
