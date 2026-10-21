import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import { createDrawer } from "../drawer/drawer";
import { DrawerHost } from "../drawer/DrawerHost";
import { drawerSliding } from "../drawer/sliding";
import { mountPane } from "../terminal/paneHarness";
import { info, node } from "./nodes";
import { Layout } from "../app/Layout";
import { createShelfTabs, ShelfTabs } from "../shelf/Shelf";
import { Tabs } from "../ui/Tabs";
import { createShelfFrame, type ShelfFrame } from "../shelf/frame";
import { shelfSliding } from "../shelf/sliding";
import { shelfBrowser } from "../shelf/u371Browser";

const { browser, evaluate, settle, rig } = shelfBrowser();

afterEach(cleanup);

it("u2580a_instant_actions_release_slide_and_fit_once", async () => {
  vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "setTimeout", "clearTimeout"] });

  try {
    const { connected, emulators } = await mountPane([node("a")], [info("t-a")]);
    connected.rail.select("a");
    render(() => <DrawerHost drawer={connected.drawer} reducedMotion={() => false} />);
    const emulator = emulators.get("t-a")!;
    const fit = vi.spyOn(emulator, "fit");
    connected.drawer.open(() => <p>old detail</p>);
    vi.advanceTimersToNextFrame();
    fit.mockClear();
    fireEvent.keyDown(screen.getByLabelText("Close"), { key: "Escape" });
    expect(drawerSliding()).toBe(false);
    expect(screen.queryByText("old detail")).toBeNull();
    vi.advanceTimersToNextFrame();
    expect(fit).toHaveBeenCalledTimes(1);
    connected.drawer.open(() => <p>new detail</p>, "key");
    window.dispatchEvent(new Event("resize"));
    fit.mockClear();
    vi.advanceTimersToNextFrame();
    expect(fit).toHaveBeenCalledTimes(1);
    fireEvent.transitionEnd(screen.getByLabelText("Drawer"));
    vi.advanceTimersByTime(600);
    expect(screen.getByText("new detail")).toBeTruthy();
    expect(fit).toHaveBeenCalledTimes(1);
  } finally {
    cleanup();
    vi.useRealTimers();
  }
});

const load = async (reduced = false) => {
  await browser("set", "viewport", "1512", "950");
  await browser("set", "media", "light", ...(reduced ? ["reduced-motion"] : []));
  const url = `${rig.server.resolvedUrls.local[0]}harness.html?seed=tree-40`;
  await browser("open", url);
  await browser("wait", ".shelf-tabs");
  await evaluate(`(() => { localStorage.clear(); return true; })()`);
  await browser("open", url);
  await browser("wait", ".shelf-tabs");
  await browser("wait", "--fn", `!!document.querySelector('.shelf [data-todo] button')`);
  await settle();
};

// Sample the first rAF after dispatch inside the page, rather than giving a late open a retry.
// Native Enter/Space clicks are observed by the click listener installed before the real key.
const activate = async (selector: string, key: "Enter" | "Space", expression = `({
  open: document.querySelector('.drawer').dataset.open === 'true',
  content: !!document.querySelector('.drawer > :not(.close)'),
  focus: document.querySelector('.drawer .close') === document.activeElement,
  returned: document.activeElement === window.__layerOrigin
})`) => {
  await evaluate(`(() => {
    const button = document.querySelector(${JSON.stringify(selector)});
    button.focus();
    window.__layerFrame = null;
    button.addEventListener('click', () => requestAnimationFrame(() => {
      window.__layerFrame = ${expression};
    }), {once: true});
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
  for (const reduced of [false, true]) {
    await load(reduced);

    for (const key of ["Enter", "Space"] as const) {
      const opened = await activate('.shelf [data-todo] .todo-row-button', key);
      expect(opened).toMatchObject({ open: true, content: true, focus: true });
      await browser("wait", "--fn", "!!document.querySelector('.todo-detail')");
      const closed = await activate('.drawer .close', key);
      expect(closed).toMatchObject({ open: false, content: false, returned: true });
      await settle();
    }

    for (const key of ["Enter", "Space"] as const) {
      expect(await activate('#shelf-tab-todos', key, "document.querySelector('.shelf').hidden")).toBe(true);
      await settle();
      expect(await activate('#shelf-tab-todos', key, "!document.querySelector('.shelf').hidden && document.activeElement.matches('.shelf-tabs [role=tab]')")).toBe(true);
      await settle();
    }

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
    expect(await keyFrame("s", "KeyS", "document.querySelector('.shelf').hidden")).toBe(true);
    await settle();
    await leader();
    expect(await keyFrame("s", "KeyS", "!document.querySelector('.shelf').hidden && document.activeElement.matches('.shelf-tabs [role=tab]')")).toBe(true);
    await settle();

    // Select a Workstream before Cmd+T creates a Terminal; its completed RPC is readiness for minimising/restoring it.
    await browser("click", ".rail-row");
    await browser("wait", "--fn", "!!document.querySelector('.terminal-new')");
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
    expect(await keyFrame("w", "KeyW", "!document.querySelector('.bubble:not([hidden])') && document.activeElement === window.__bubbleOrigin")).toBe(true);
    await settle();
  }
}, 120_000);

it("u2580a_key_close_and_interrupted_slide_leave_no_stale_content", async () => {
  for (const reduced of [false, true]) {
    await load(reduced);

    const observed = await evaluate(`(async () => {
      const button = document.querySelector('.shelf [data-todo] .todo-row-button');
      button.focus();
      button.dispatchEvent(new MouseEvent('click', {bubbles: true, detail: 1}));
      // Interrupt before the pointer slide has completed, in the next browser frame.
      await new Promise(resolve => requestAnimationFrame(resolve));
      document.querySelector('.drawer .close').dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', code: 'Escape', bubbles: true}));
      return await new Promise(resolve => requestAnimationFrame(() => resolve({
        content: !!document.querySelector('.drawer > :not(.close)'),
        returned: document.activeElement === button
      })));
    })()`);

    expect(observed).toEqual({ content: false, returned: true });
    await settle();

    // U3010b: pointer open, close, reopen, then each key ends the slide by the next frame with no exit content and U40's return.
    for (const key of ["Escape", "Enter", "Space"] as const) {
      const interrupted = await evaluate(`(async () => {
        const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
        const click = (selector) => document.querySelector(selector).dispatchEvent(new MouseEvent('click', {bubbles: true, detail: 1}));
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
          content: !!document.querySelector('.drawer > :not(.close)'),
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

it("u2580a_shelf_instant_actions_release_slide_and_fit_once", async () => {
  vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame"] });

  try {
    const { connected, emulators } = await mountPane([node("a")], [info("t-a")]);
    connected.rail.select("a");
    let frame: ShelfFrame | undefined;
    render(() => {
      frame = createShelfFrame(() => "/test", () => false, () => {});
      const state = frame;

      const tabs = createShelfTabs(state);

      return <Tabs.RootProvider value={tabs}><Layout header={<ShelfTabs frame={state} onToggle={state.toggle} />} rail={null} centre={null} shelf={null}
        overlay={null} shelfPlacement={{ open: state.open(), rendered: state.rendered(), shown: state.shown(), animated: state.animated(), onSettle: state.settle }} /></Tabs.RootProvider>;
    });
    const fit = vi.spyOn(emulators.get("t-a")!, "fit");
    frame!.toggle("pointer");
    window.dispatchEvent(new Event("resize"));
    vi.advanceTimersToNextFrame();
    expect(shelfSliding()).toBe(true);
    fit.mockClear();
    // Enter/Space produce a detail=0 click; it reverses the in-flight pointer close.
    fireEvent.click(screen.getByRole("tab", { name: /^Todos/, hidden: true }), { detail: 0 });
    expect(shelfSliding()).toBe(false);
    vi.advanceTimersToNextFrame();
    expect(fit).toHaveBeenCalledTimes(1);
    frame!.toggle("key");
    window.dispatchEvent(new Event("resize"));
    fit.mockClear();
    vi.advanceTimersToNextFrame();
    expect(frame!.rendered()).toBe(false);
    expect(fit).toHaveBeenCalledTimes(1);
    frame!.toggle("pointer");
    expect(shelfSliding()).toBe(true);
  } finally {
    cleanup();
    vi.useRealTimers();
  }
});


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
