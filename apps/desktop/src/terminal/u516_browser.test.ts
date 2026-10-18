import { expect, it } from "vitest";
import { browser, read, url, wait } from "../ui/tabsBrowser";

const load = async (query = "") => {
  await browser("open", url(`/src/terminal/u515.html${query}`));
  await wait("document.body.dataset.ready === '1' && document.querySelectorAll('.turn-gutter').length === 3");
};

it("u516_browser_one_agent_receives_the_turn_and_the_user_sees_where_it_went", async () => {
  await load("?agents=1");
  await browser("click", ".turn-gutter:first-of-type");
  await wait("!!document.querySelector('.send-to-agent')");
  await browser("eval", "document.querySelector('.pane-screen').dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'a', code: 'KeyA', metaKey: true, shiftKey: true }))");
  await wait("document.activeElement === document.querySelector('.send-to-agent-note')");
  await browser("type", ".send-to-agent-note", "why");
  await browser("press", "Enter");
  await wait("window.__calls.length === 1");
  expect(await read<string>("window.__calls[0].body")).toBe("why\n\n```\n$ one\n1\n```\n\ncommand: one\ncwd: /work\nexit: 0");
  await wait("document.querySelector('.app-toast-action')");
}, 90_000);

it.each([1, 2])("u2680b_selection_actions_keep_the_excerpt_and_clear_the_highlight_%s_receivers", async (agents) => {
  await load(`?agents=${agents}`);
  await browser("click", ".turn-gutter:first-of-type");
  await wait("!!document.querySelector('.send-to-agent')");
  await browser("click", ".send-to-agent-action");

  if (agents === 2) {
    await wait("document.querySelectorAll('[role=menuitem]').length === 2");
    await browser("click", "[role=menuitem]:first-of-type");
  }

  await wait("window.__calls.length === 1 && window.__emu.selection() === ''");
  expect(await read<string>("window.__calls[0].body")).toBe("```\n$ one\n1\n```\n\ncommand: one\ncwd: /work\nexit: 0");
}, 90_000);
