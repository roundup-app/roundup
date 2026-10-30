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
  await wait(`!!window.__question.shown`);
  await browser("eval", "window.__question.answer(true)");
  await wait(`document.querySelector('[role=alert]')?.textContent.includes('could not close project')`);
};

it("u501_full_content_is_available", async () => {
  await open("tree-40");
  await failClose();
  expect(await read<string>(`document.querySelector('[role=alert]').textContent`)).toMatch(/\S/);
  expect(await read<boolean>(`document.querySelector('[role=alert]').hasAttribute('title')`)).toBe(false);
  await browser("hover", "[role=alert]");
  await wait(`document.querySelector('.app-tooltip')?.textContent === ${JSON.stringify(FAILURE)}`);
  await browser("mouse", "move", "1", "1");
  await wait(`!document.querySelector('.app-tooltip')`);

  // Close the Shelf before walking the Rail; an open bar tab leads into its panel.
  await browser("click", '#shelf-tab-todos[aria-expanded="true"]');

  await browser("press", "Tab");
  await read(`document.activeElement.blur()`);
  await wait(`!document.querySelector('.app-tooltip')`);
  await browser("focus", "[role=alert]");
  await wait(`document.querySelector('.app-tooltip')?.textContent === ${JSON.stringify(FAILURE)}`);

  await open("resources");
  await browser("click", '[data-id="worktree-agent"]');
  await read(`window.dispatchEvent(new CustomEvent("open-project-page", { detail: {path:"/Users/you/harness", command:"view:resources"} }))`);
  await wait(`document.querySelectorAll('.resource-value').length === 3`);
  await browser("hover", ".resource-value");
  await wait(`document.querySelector('.app-tooltip')?.textContent === document.querySelector('.resource-name').textContent`);
}, 60_000);
