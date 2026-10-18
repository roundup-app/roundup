import { expect, it } from "vitest";
import { browser, read, url, wait } from "../ui/tabsBrowser";

const open = async (seed: string) => {
  await browser("open", url(`/harness.html?seed=${seed}`));
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

  // Close the Shelf before walking the Rail; an open bar tab leads into its panel.
  await browser("click", '#shelf-tab-todos[aria-expanded="true"]');

  for (let i = 0; i < 12 && !(await read<boolean>(`document.activeElement?.matches("[role=alert]") === true`)); i++) await browser("press", "Tab");
  await wait(`document.querySelector('.app-tooltip')?.textContent === ${JSON.stringify(FAILURE)}`);

  await open("resources");
  await browser("click", '[data-id="worktree-agent"]');
  await wait(`document.querySelectorAll('.resource-value').length === 3`);
  await browser("hover", ".resource-value");
  await wait(`document.querySelector('.app-tooltip')?.textContent === document.querySelector('.resource-name').textContent`);
}, 120_000);
