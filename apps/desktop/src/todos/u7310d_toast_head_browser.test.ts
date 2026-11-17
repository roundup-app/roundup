import { expect, it } from "vitest";
import { documentBrowser, title } from "./u4698dBrowser";

const { browser, evaluate, openDocument } = documentBrowser();

it("u7310d_toast_leaves_the_drawer_head_clickable", { retry: 0, timeout: 90_000 }, async () => {
  await openDocument(1280, 820);
  await browser("dblclick", ".todo-detail-title p");
  await browser("wait", ".todo-detail-title textarea");
  await browser("fill", ".todo-detail-title textarea", title + " retained");
  await evaluate("window.__fake.failNext(-32003, 'Title could not be saved. Keep this draft and retry.', 'todo.update'); true");
  await browser("press", "Enter");
  await browser("wait", ".app-toast [role=alert]");
  await browser("focus", ".todo-detail-title textarea");
  await browser("press", "Escape");
  await browser("wait", ".todo-detail-title p");

  // The failure stays up while the pointer works the Drawer's head.
  await browser("click", '.drawer [aria-label="More actions"]');
  await browser("wait", '[role="menu"][data-open]');
  await browser("press", "Escape");
  await browser("wait", "--fn", "!document.querySelector('[role=menu][data-open]')");
  expect(await evaluate("!!document.querySelector('.app-toast [role=alert]')")).toBe(true);
  await browser("click", ".drawer .close");
  await browser("wait", '.drawer[data-open="false"]');
});
