import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { createDrawer } from "../drawer/drawer";
import { DrawerHost } from "../drawer/DrawerHost";
import { shelfBrowser } from "../shelf/u371Browser";

// Observe before the registry consumes handled keys at window capture.
const { browser, evaluate, settle, rig } = shelfBrowser(`if (location.protocol === "http:") localStorage.clear();
if (!window.__layerWatch) {
  window.__layerWatch = true;
  window.addEventListener('keydown', () => window.__layerSample?.(), true);
}`);

afterEach(cleanup);

const load = async (reduced = false) => {
  await browser("set", "viewport", "1512", "950");
  await browser("set", "media", "light", ...(reduced ? ["reduced-motion"] : []));
  const url = `${rig.server.resolvedUrls.local[0]}harness.html?view=workstreams&items=1&tabs=1&seed=selection`;
  await browser("open", url);
  await browser("wait", ".shelf-tabs");
  await browser("wait", "--fn", `!!document.querySelector('.shelf [data-shelf-group="unassigned"] [data-part="branch-control"], .shelf [data-todo] button')`);
  await evaluate(`(() => { document.querySelector('.shelf [data-shelf-group="unassigned"][data-state="closed"] [data-part="branch-control"]')?.click(); return true; })()`);
  await browser("wait", "--fn", `!!document.querySelector('.shelf [data-todo] button')`);
  await settle();
};

// Sample the first rAF after dispatch inside the page, rather than giving a late open a retry.
// Native Enter/Space clicks are observed by the click listener installed before the real key.
const activate = async (selector: string, key: "Enter" | "Space", expression = `({
  open: document.querySelector('.drawer').dataset.open === 'true',
  content: !!document.querySelector('.drawer > :not(.drawer-controls)'),
  focus: document.querySelector('.drawer .close') === document.activeElement,
  returned: document.activeElement === window.__layerOrigin
})`) => {
  await evaluate(`(() => {
    const button = document.querySelector(${JSON.stringify(selector)});
    button.focus();
    window.__layerFrame = null;
    const sample = () => requestAnimationFrame(() => {
      window.__layerFrame = ${expression};
    });
    if (button.matches('.todo-row-button')) window.__layerSample = () => {
      window.__layerSample = null;
      sample();
    };
    else button.addEventListener('click', sample, {once: true});
    window.__layerOrigin ??= button;
    return true;
  })()`);
  await browser("press", key);
  await browser("wait", "--fn", "window.__layerFrame !== null");

  return evaluate<unknown>("window.__layerFrame");
};

const keyFrame = async (key: string, code: string, expression: string, meta = false) => evaluate(`(async () => {
  document.activeElement.dispatchEvent(new KeyboardEvent('keydown', {key: ${JSON.stringify(key)}, code: ${JSON.stringify(code)}, metaKey: ${meta}, bubbles: true, cancelable: true}));
  return await new Promise(resolve => requestAnimationFrame(() => resolve(${expression})));
})()`);

const leader = async () => {
  expect(await keyFrame("k", "KeyK", "!!document.querySelector('.leader')", true)).toBe(true);
};

it("u2580a_key_layers_open_and_focus_in_the_next_frame", async () => {
  for (const reduced of [false]) {
    await load(reduced);

    // Enter on the row opens the detail; row selection alone opens none.
    const opened = await activate('.shelf [data-todo] .todo-row-button', "Enter");
    expect(opened).toMatchObject({ open: true, content: true, focus: true });
    await browser("wait", "--fn", "!!document.querySelector('.todo-detail')");
    const closed = await activate('.drawer .close', "Space");
    // U3721b: a key close slides in the key duration, so only the focus return is checked at the next frame.
    expect(closed).toMatchObject({ returned: true });
    await settle();


    await evaluate(`(() => { window.__layerOrigin = document.querySelector('.rail-row'); window.__layerOrigin.focus(); return true; })()`);
    await leader();
    expect(await evaluate("document.activeElement === window.__layerOrigin")).toBe(true);
    expect(await keyFrame("Escape", "Escape", "!document.querySelector('.leader') && document.activeElement === window.__layerOrigin")).toBe(true);
    await settle();
    expect(await keyFrame("?", "Slash", "!!document.querySelector('.help') && document.querySelector('.help').contains(document.activeElement)")).toBe(true);
    await browser("wait", ".help");
    expect(await keyFrame("Escape", "Escape", "!document.querySelector('.help') && document.activeElement === window.__layerOrigin")).toBe(true);
    await settle();
    await leader();
    expect(await keyFrame("k", "KeyK", "!!document.querySelector('.switcher') && document.querySelector('.switcher').contains(document.activeElement)")).toBe(true);
    await browser("wait", ".switcher input");
    expect(await keyFrame("Escape", "Escape", "!document.querySelector('.switcher') && document.activeElement === window.__layerOrigin")).toBe(true);
    await settle();
    await leader();
    // U3721b: a key size change slides in the key duration; the Bench settles after it, not by the next frame.
    await keyFrame("b", "KeyB", "true");
    await browser("wait", "--fn", "document.querySelector('.window').dataset.shelfMaximised === 'true' || document.querySelector('.shelf').hidden");
    await settle();
    await leader();
    await keyFrame("b", "KeyB", "true");
    await browser("wait", "--fn", "document.querySelector('.shelf').hidden");
    await settle();
    await leader();
    expect(await keyFrame("b", "KeyB", "!document.querySelector('.shelf').hidden && document.activeElement.matches('.shelf-tabs [role=tab]')")).toBe(true);
    await settle();

    // Select the row itself: its centre can contain a quick action on hover.
    await browser("focus", '.rail-row[data-id="backend"]');
    await browser("press", "Enter");
    await browser("wait", "--fn", `!!document.querySelector('.rail-row[data-selected="true"]') && !!document.activeElement.closest('.pane-screen')`);
    await settle();
    await evaluate(`(() => { window.__bubbleOrigin = document.activeElement; return true; })()`);
    expect(await keyFrame("t", "KeyT", "!!document.querySelector('.bubble:not([hidden])') && !!document.activeElement.closest('.bubble')", true)).toBe(true);
    await browser("wait", ".bubble .xterm-screen");
    await leader();
    expect(await keyFrame("m", "KeyM", "!document.querySelector('.bubble:not([hidden])') && document.activeElement.matches('button.terminal-tab')")).toBe(true);
    await settle();
    await leader();
    expect(await keyFrame("m", "KeyM", "!!document.querySelector('.bubble:not([hidden])') && !!document.activeElement.closest('.bubble')")).toBe(true);
    await settle();
    await leader();
    expect(await keyFrame("w", "KeyW", "!!window.__fake.app.answerQuestion && !!document.querySelector('.bubble:not([hidden])')")).toBe(true);
    await evaluate(`window.__fake.app.answerQuestion(true)`);
    await browser("wait", "--fn", "!document.querySelector('.bubble:not([hidden])') && document.activeElement === window.__bubbleOrigin");
    await settle();
  }
}, 120_000);

it("u2580a_key_close_and_interrupted_slide_leave_no_stale_content", async () => {
  for (const reduced of [false]) {
    await load(reduced);

    const observed = await evaluate(`(async () => {
      const button = document.querySelector('.shelf [data-todo] .todo-row-button');
      button.focus();
      button.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', code: 'Enter', bubbles: true, cancelable: true}));
      // Interrupt before the pointer slide has completed, in the next browser frame.
      await new Promise(resolve => requestAnimationFrame(resolve));
      document.querySelector('.drawer .close').dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', code: 'Escape', bubbles: true}));
      return await new Promise(resolve => requestAnimationFrame(() => resolve({
        content: !!document.querySelector('.drawer > :not(.drawer-controls)'),
        returned: document.activeElement === button
      })));
    })()`);

    expect(observed).toMatchObject({ returned: true });
    await settle();

    // U3010b: pointer open, close, reopen, then each key ends the slide by the next frame with no exit content and U40's return.
    for (const key of ["Escape", "Enter", "Space"] as const) {
      const interrupted = await evaluate(`(async () => {
        const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
        const click = (selector) => document.querySelector(selector).dispatchEvent(selector === '.drawer .close' ? new MouseEvent('click', {bubbles: true, detail: 1}) : new KeyboardEvent('keydown', {key: 'Enter', code: 'Enter', bubbles: true, cancelable: true}));
        const button = document.querySelector('.shelf [data-todo] .todo-row-button');
        button.focus();
        click('.shelf [data-todo] .todo-row-button');
        await frame();
        click('.drawer .close');
        await frame();
        button.focus();
        click('.shelf [data-todo] .todo-row-button');
        await frame();
        const close = document.querySelector('.drawer .close');
        close.focus();
        close.dispatchEvent(new KeyboardEvent('keydown', {key: ${JSON.stringify(key === "Space" ? " " : key)}, code: ${JSON.stringify(key)}, bubbles: true}));
        if (${JSON.stringify(key)} !== 'Escape') close.click();
        return await new Promise(resolve => requestAnimationFrame(() => resolve({
          content: !!document.querySelector('.drawer > :not(.drawer-controls)'),
          returned: document.activeElement === button
        })));
      })()`);

      expect(interrupted).toEqual({ content: false, returned: true });
      await settle();
    }

    await settle();
    expect(await activate('.shelf [data-todo] .todo-row-button', "Enter")).toMatchObject({ open: true, focus: true });
    await browser("wait", ".todo-detail");
    await evaluate(`(() => { document.querySelector('.drawer').dispatchEvent(new TransitionEvent('transitionend', {propertyName: 'transform'})); return true; })()`);
    expect(await evaluate("!!document.querySelector('.todo-detail')")).toBe(true);
    await settle();
    expect(await evaluate(`(async () => {
      document.querySelector('.drawer .close').dispatchEvent(new MouseEvent('click', {bubbles: true, detail: 1}));
      return await new Promise(resolve => requestAnimationFrame(() => resolve(!!document.querySelector('.todo-detail'))));
    })()`)).toBe(!reduced);
    // The returned trigger can reopen while the pointer exit is still in flight.
    expect(await activate('.shelf [data-todo] .todo-row-button', "Enter")).toMatchObject({ open: true, content: true, focus: true });
    await browser("wait", ".todo-detail");
    await evaluate(`(() => { document.querySelector('.drawer').dispatchEvent(new TransitionEvent('transitionend', {propertyName: 'transform'})); return true; })()`);
    await settle();
    expect(await evaluate("!!document.querySelector('.todo-detail')")).toBe(true);
  }
}, 90_000);

it("u2580a_key_close_returns_focus_before_content_is_removed", () => {
  const drawer = createDrawer();
  render(() => <><button type="button">Origin</button><DrawerHost drawer={drawer} reducedMotion={() => false} /></>);
  const origin = screen.getByRole("button", { name: "Origin" });
  origin.focus();
  drawer.open(() => <button type="button" onClick={(event) => drawer.close(event.detail === 0 ? "key" : "pointer")}>Finish</button>);
  const finish = screen.getByRole("button", { name: "Finish" });
  finish.focus();
  fireEvent.click(finish, { detail: 0 });
  expect(document.activeElement).toBe(origin);
});
