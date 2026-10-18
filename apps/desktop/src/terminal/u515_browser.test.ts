import { expect, it } from "vitest";
import { browser, read, url, wait } from "../ui/tabsBrowser";

const load = async (query = "") => {
  await browser("open", url(`/src/terminal/u515.html${query}`));
  await wait("document.body.dataset.ready === '1' && document.querySelectorAll('.turn-gutter').length === 3");
};

it("u515_browser_the_control_leaves_the_keyboard_in_the_terminal", async () => {
  await load("?agents=1");
  await browser("click", ".turn-gutter:first-of-type");
  await wait("!!document.querySelector('.send-to-agent')");
  expect(await read<boolean>("!document.querySelector('.send-to-agent').contains(document.activeElement)")).toBe(true);
}, 90_000);

it("u515_browser_several_agents_open_a_menu_by_keyboard", async () => {
  await load();
  await browser("click", ".turn-gutter:first-of-type");
  await wait("!!document.querySelector('.send-to-agent')");
  await browser("focus", ".send-to-agent-note");
  await browser("press", "Enter");
  await wait("document.querySelectorAll('[role=menuitem]').length === 2");
  await browser("press", "Enter");
  await wait("window.__calls.length === 1");
  expect(await read<string>("window.__calls[0].to")).toBe("a");
}, 90_000);

it("u3705_browser_focus_opens_the_no_agent_tooltip", async () => {
  await load("?agents=0");
  await browser("click", ".turn-gutter:first-of-type");
  await wait("!!document.querySelector('.send-to-agent')");
  await browser("focus", ".send-to-agent-note");
  await browser("press", "Tab");
  await wait("document.activeElement?.classList.contains('send-to-agent-action')");
  await wait("document.querySelector('[role=tooltip]')?.textContent === 'No running agent'");
}, 90_000);
