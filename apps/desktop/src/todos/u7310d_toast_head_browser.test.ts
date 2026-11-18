import { expect, it } from "vitest";
import { documentBrowser, title } from "./u4698dBrowser";

const { browser, evaluate, openDocument } = documentBrowser();

// A long reason makes a card tall, the case where a Toast stack reaches furthest over a Drawer.
const diskFull = " The Daemon refused the write because its disk is full, so free space first and retry once more before you close this Todo or switch to another one.";

it("u7310d_toast_leaves_the_drawer_head_clickable", { retry: 0, timeout: 150_000 }, async () => {
  await openDocument(1280, 820);
  await browser("dblclick", ".todo-detail-title p");
  await browser("wait", ".todo-detail-title textarea");
  await browser("fill", ".todo-detail-title textarea", title + " retained");
  await evaluate(`window.__fake.failNext(-32003, 'Title could not be saved. Keep this draft and retry.${diskFull}', 'todo.update'); true`);
  await browser("press", "Enter");
  await browser("wait", ".app-toast [role=alert]");
  await browser("focus", ".todo-detail-title textarea");
  await browser("press", "Escape");
  await browser("wait", ".todo-detail-title p");

  // The failure stays up while the pointer works the Drawer's head, then its Activity and comment block at the end of the scroll, at the default size and filled.
  const field = ".drawer .todo-comment-field";
  const history = ".drawer .todo-history-line";
  const expanded = () => evaluate<string>(`document.querySelector('${history}').getAttribute('aria-expanded')`);
  const scrollToEnd = () => evaluate("(() => { const body = document.querySelector('.drawer .todo-detail'); body.scrollTop = body.scrollHeight; return true; })()");

  const workDrawer = async () => {
    await browser("click", '.drawer [aria-label="More actions"]');
    await browser("wait", '[role="menu"][data-open]');
    await browser("press", "Escape");
    await browser("wait", "--fn", "!document.querySelector('[role=menu][data-open]')");
    await scrollToEnd();
    const before = await expanded();
    await browser("click", history);
    expect(await expanded()).not.toBe(before);
    await scrollToEnd();
    await browser("click", field);
    expect(await evaluate("document.activeElement.matches('.drawer .todo-comment-field')")).toBe(true);
    expect(await evaluate("!!document.querySelector('.app-toast [role=alert]')")).toBe(true);
  };

  // The rig remembers the filled size; the default size comes first.
  await browser("click", '.drawer [aria-label="Restore"]');
  await browser("wait", '.drawer[data-fill="false"]');
  await workDrawer();
  await browser("fill", field, "kept comment");
  await evaluate(`window.__fake.failNext(-32003, 'Comment could not be sent. Keep this draft and retry.${diskFull}', 'todo.comment'); true`);
  await browser("click", '.drawer [aria-label="Comment"]');
  await browser("wait", "--fn", "[...document.querySelectorAll('.app-toast')].some(card => card.textContent.includes('Comment could not be sent'))");
  await browser("click", '.drawer [aria-label="Maximise"]');
  await browser("wait", '.drawer[data-fill="true"]');
  await workDrawer();
  await browser("click", '.drawer [aria-label="Comment"]');
  await browser("wait", "--fn", "[...document.querySelectorAll('.drawer .todo-comment-body')].some(el => el.textContent === 'kept comment')");
  await browser("click", ".drawer .close");
  await browser("wait", '.drawer[data-open="false"]');
});
