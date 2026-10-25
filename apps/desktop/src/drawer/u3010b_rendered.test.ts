import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { captureDir } from "../testing/captures";
import { shelfBrowser } from "../shelf/u371Browser";

/**
 * U3010b's rendered observer: the Inbox Drawer pointer open, reversal at 50% displaced, reopen at 50% of the return, then Escape,
 * in dark 1512×950 on `tree-40`. Raw timestamped boxes go to `captureDir("U3010b")` for the design critic; docs/motion.md
 * names the protocol. Quarter speed is `Animation.playbackRate`, never a longer Token.
 */
const art = captureDir("U3010b");

const rendered = art ? it : it.skip;

const { browser, evaluate, settle, rig, openShelf } = shelfBrowser();

// Ordinary CI observers use the same isolated browser as the optional critic traces below.
// The fixture exercises the public Drawer actions and the real DrawerHost, with browser-owned animations.
const mountDrawer = async () => {
  await openShelf("tree-40", 288, 320, 1512, "dark");
  await browser("set", "viewport", "1512", "950");
  await evaluate(`(async () => {
    const source = await (await fetch('/src/drawer/DrawerHost.tsx')).text();
    const dependencies = source.split('"').filter(path => path.includes('/deps/'));
    const { createComponent } = await import(dependencies.find(path => path.includes('/solid-js.js')));
    const { render } = await import(dependencies.find(path => path.includes('/solid-js_web.js')));
    const { createDrawer } = await import('/src/drawer/drawer.ts');
    const { DrawerHost } = await import('/src/drawer/DrawerHost.tsx');
    const { drawerSliding } = await import('/src/drawer/sliding.ts');
    const { createReducedMotion } = await import('/src/app/reducedMotion.ts');
    const root = document.createElement('div');
    root.id = 'drawer-observer';
    document.querySelector('.window .overlay').append(root);
    const drawer = createDrawer();
    let submits = 0;
    let incarnation = 0;
    const trigger = document.createElement('button');
    trigger.id = 'drawer-trigger';
    trigger.textContent = 'Open observer drawer';
    document.querySelector('.window').prepend(trigger);
    trigger.addEventListener('click', () => {
      drawer.open(() => {
      const form = document.createElement('form');
      form.dataset.incarnation = String(++incarnation);
      form.innerHTML = '<textarea aria-label="draft"></textarea><button type="submit">Send</button>';
      form.addEventListener('submit', event => { event.preventDefault(); submits++; });
      return form;
      });
      if (window.__drawerObserver.hold) panel.getAnimations().forEach(animation => animation.pause());
    });
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    let beforePreference;
    media.addEventListener('change', () => { beforePreference = window.__drawerObserver.state(); });
    const dispose = render(() => {
      const reducedMotion = createReducedMotion(() => media);
      return createComponent(DrawerHost, { drawer, reducedMotion });
    }, root);
    const panel = root.querySelector('.drawer');
    const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
    const animations = () => panel.getAnimations();
    const finished = async () => {
      await frame();
      await Promise.all(animations().map(animation => animation.finished.catch(() => {})));
    };
    window.__drawerObserver = {
      drawer, panel, dispose, frame, animations, finished, preferences: [],
      state: () => ({ open: drawer.content() !== null, sliding: drawerSliding(),
        incarnation: panel.querySelector('form')?.dataset.incarnation ?? null,
        retained: !!panel.querySelector('form'), inert: panel.inert, submits,
        focused: panel.contains(document.activeElement), returned: document.activeElement === trigger }),
    };
    media.addEventListener('change', () => window.__drawerObserver.preferences.push({ before: beforePreference, after: window.__drawerObserver.state() }));
    // Capture retention synchronously after the public close, before the browser can finish its exit.
    document.addEventListener('click', event => {
      if (!panel.querySelector('.close').contains(event.target)) return;
      const observer = window.__drawerObserver;
      observer.exit = observer.state();
      observer.draft = panel.querySelector('textarea');
      observer.text = observer.draft?.value;
      observer.draft?.focus();
      observer.exitFocused = panel.contains(document.activeElement);
      if (observer.hold) animations().forEach(animation => animation.pause());
    });
    // The key registry stops keydown propagation; keyup observes its completed action before any timed exit.
    document.addEventListener('keyup', event => {
      if (event.key === 'Escape') window.__drawerObserver.escape = window.__drawerObserver.state();
    });
    return true;
  })()`);
  await settle();
};

const drawerState = () => evaluate<{ open: boolean; sliding: boolean; retained: boolean; inert: boolean; submits: number; focused: boolean; returned: boolean }>("window.__drawerObserver.state()");

const waitForDrawer = async () => {
  await evaluate("window.__drawerObserver.finished().then(() => true)");
  await browser("wait", "--fn", "!window.__drawerObserver.state().sliding");
};

it("u3010b_latest_action_owns_layer_lifetime", { retry: 0 }, async () => {
  await mountDrawer();
  await browser("click", "#drawer-trigger");
  await waitForDrawer();
  expect(await drawerState()).toMatchObject({ open: true, retained: true, focused: true, incarnation: "1" });
  await browser("click", "#drawer-observer .close");
  await browser("click", "#drawer-trigger");
  await waitForDrawer();
  expect(await evaluate("window.__drawerObserver.exit")).toMatchObject({ open: false, retained: true, inert: true, sliding: true });
  expect(await drawerState()).toMatchObject({ open: true, retained: true, sliding: false, focused: true, incarnation: "2" });
  await browser("press", "Escape");
  expect(await evaluate("window.__drawerObserver.escape")).toMatchObject({ open: false, retained: false, sliding: false, returned: true });
});

it("u3010b_stale_completion_has_no_new_layer_effect", { retry: 0 }, async () => {
  await mountDrawer();
  await browser("click", "#drawer-trigger");
  await waitForDrawer();

  // Retarget within a real animation frame, so CLI round-trips cannot turn the reversal into two settled slides.
  // Calling the public actions in one browser task guarantees an interrupted exit.
  const result = await evaluate(`(async () => {
    const o = window.__drawerObserver;
    o.drawer.close();
    await o.frame();
    const old = o.animations().map(animation => animation.finished.catch(() => {}));
    const exit = o.state();
    o.drawer.open(() => { const content = document.createElement('p'); content.textContent = 'reopened'; return content; });
    await Promise.all(old);
    const afterOld = { ...o.state(), text: o.panel.textContent };
    await o.finished();
    return { exit, afterOld };
  })()`);

  expect(result).toMatchObject({ exit: { retained: true, sliding: true }, afterOld: { open: true, sliding: true, text: expect.stringContaining("reopened") } });
  await waitForDrawer();
  expect(await drawerState()).toMatchObject({ open: true, sliding: false });
});

it("z3742c_a_layer_without_animations_releases_its_content", { retry: 0 }, async () => {
  await mountDrawer();
  await browser("click", "#drawer-trigger");
  await waitForDrawer();

  const result = await evaluate(`(async () => {
    const o = window.__drawerObserver;
    o.panel.style.setProperty('--duration-drawer', '0ms');
    o.drawer.close();
    const animations = o.animations().length;
    await o.finished();
    return { animations, state: o.state() };
  })()`);

  expect(result).toMatchObject({ animations: 0, state: { open: false, retained: false, sliding: false } });
});

it("z3742c_cancelling_the_current_exit_releases_its_content", { retry: 0 }, async () => {
  await mountDrawer();
  await browser("click", "#drawer-trigger");
  await waitForDrawer();

  const result = await evaluate(`(async () => {
    const o = window.__drawerObserver;
    o.drawer.close();
    await o.frame();
    const animations = o.animations();
    const completion = Promise.all(animations.map(animation => animation.finished.catch(() => {})));
    const before = o.state();
    animations.forEach(animation => animation.cancel());
    await completion;
    // The browser's completion promises, including cancellation, are the lifetime acknowledgement.
    await Promise.resolve();
    return { before, after: o.state() };
  })()`);

  expect(result).toMatchObject({ before: { open: false, retained: true, sliding: true }, after: { open: false, retained: false, sliding: false, returned: true } });
});

it("u3010b_dispose_mid_slide_clears_sliding", { retry: 0 }, async () => {
  await mountDrawer();
  await browser("click", "#drawer-trigger");
  await waitForDrawer();
  expect(await evaluate(`(async () => {
    const o = window.__drawerObserver;
    o.drawer.close();
    await o.frame();
    const before = o.state().sliding;
    o.dispose();
    return { before, after: o.state().sliding };
  })()`)).toEqual({ before: true, after: false });
});

it("u3010b_exit_preserves_draft_and_submit_identity", { retry: 0 }, async () => {
  await mountDrawer();
  await browser("click", "#drawer-trigger");
  await waitForDrawer();
  await browser("fill", "#drawer-observer textarea", "line one\nline two");
  await evaluate("(() => { window.__drawerObserver.original = document.querySelector('#drawer-observer textarea'); return true; })()");
  await browser("click", "#drawer-observer .close");
  expect(await evaluate(`(() => {
    const o = window.__drawerObserver;
    return { exit: o.exit, same: o.draft === o.original, text: o.text, focused: o.exitFocused };
  })()`)).toMatchObject({ exit: { retained: true, inert: true }, same: true, text: "line one\nline two", focused: false });
  await browser("press", "Tab");
  await browser("press", "Enter");
  await waitForDrawer();
  expect(await drawerState()).toMatchObject({ submits: 0 });
});

it("u5_a_closed_drawer_unmounts_its_content_when_the_slide_out_ends", { retry: 0 }, async () => {
  await mountDrawer();
  await browser("click", "#drawer-trigger");
  await waitForDrawer();
  await browser("click", "#drawer-observer .close");
  await waitForDrawer();
  expect(await drawerState()).toMatchObject({ open: false, retained: false, sliding: false });
});

it("u3010b_preference_change_preserves_destination_and_focus", { retry: 0 }, async () => {
  await mountDrawer();
  // Pause actual browser animations so the preference interrupts a slide rather than CLI startup consuming it.
  await evaluate("(() => { window.__drawerObserver.hold = true; return true; })()");
  await browser("click", "#drawer-trigger");
  await browser("set", "media", "dark", "reduced-motion");
  await waitForDrawer();
  expect(await drawerState()).toMatchObject({ open: true, retained: true, sliding: false, focused: true });
  await browser("set", "media", "dark");
  expect(await drawerState()).toMatchObject({ open: true, sliding: false });
  await browser("click", "#drawer-observer .close");
  await browser("set", "media", "dark", "reduced-motion");
  await waitForDrawer();
  expect(await drawerState()).toMatchObject({ open: false, retained: false, sliding: false, returned: true });
  await browser("set", "media", "dark");
  await evaluate(`(async () => {
    const o = window.__drawerObserver;
    o.drawer.open(() => { const form = document.createElement('form'); return form; });
    await o.frame();
    o.drawer.close();
    await o.frame();
    o.drawer.open(() => { const form = document.createElement('form'); return form; });
    o.animations().forEach(animation => animation.pause());
    return true;
  })()`);
  await browser("set", "media", "dark", "reduced-motion");
  await waitForDrawer();
  expect(await drawerState()).toMatchObject({ open: true, retained: true, sliding: false, focused: true });
  expect(await evaluate("window.__drawerObserver.preferences")).toMatchObject([
    { before: { open: true, sliding: true }, after: { open: true, sliding: false, focused: true } },
    { after: { open: true, sliding: false } },
    { before: { open: false, sliding: true, retained: true }, after: { open: false, sliding: false, retained: false } },
    { after: { open: false, sliding: false } },
    { before: { open: true, sliding: true }, after: { open: true, sliding: false, focused: true } },
  ]);
});

it("u430_terminal_gets_one_resize_per_slide", { retry: 0 }, async () => {
  await openShelf("tree-40", 288, 320, 1512, "dark");
  await browser("set", "viewport", "1512", "950");
  await browser("click", '.rail [data-id="tokens"] .name');
  await browser("wait", ".xterm-screen");
  await settle();
  await evaluate("(() => { document.querySelector('.todos-tab [data-shelf-group=unassigned][data-state=closed] [data-part=branch-control]')?.click(); return true; })()");
  await browser("wait", ".shelf [data-todo] .todo-row-button");
  await browser("click", ".shelf [data-todo] .todo-row-button");
  await settle();
  await evaluate(`(async () => {
    const { drawerSliding } = await import('/src/drawer/sliding.ts');
    const app = window.__fake.app;
    window.__drawerResizes = [];
    app.handlers['terminal.resize'] = params => {
      window.__drawerResizes.push({ params, sliding: drawerSliding() });
      return null;
    };
    window.__drawerResizeFrames = [];
    const sample = () => {
      window.__drawerResizeFrames.push(window.__drawerResizes.length);
      window.__drawerResizeFrame = requestAnimationFrame(sample);
    };
    window.__drawerResizeFrame = requestAnimationFrame(sample);
    return true;
  })()`);

  for (const [selector, count] of [['.shelf [data-todo] .row-controls button[aria-label="Open"]', 1], [".drawer .close", 2]] as const) {
    await browser("click", selector);
    await settle();
    expect(await evaluate("window.__drawerResizes.length")).toBe(count);
  }

  expect(await evaluate(`(() => {
    cancelAnimationFrame(window.__drawerResizeFrame);
    return { counts: [...new Set(window.__drawerResizeFrames)], ids: window.__drawerResizes.map(call => call.params.id), sliding: window.__drawerResizes.map(call => call.sliding) };
  })()`)).toEqual({ counts: [0, 1, 2], ids: ["t-tokens", "t-tokens"], sliding: [false, false] });
});

const trace = (rate: number) => `(async () => {
  const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
  const drawer = document.querySelector('.drawer');
  const row = () => document.querySelector('.shelf [data-todo] .todo-row-button');
  const open = () => click(document.querySelector('.shelf [data-todo] .row-controls button[aria-label=Open]'));
  const box = () => { const r = drawer.getBoundingClientRect(); return { left: r.left, width: r.width }; };
  const slow = () => document.getAnimations().forEach(a => { a.playbackRate = ${rate}; });
  const samples = [];
  const log = (event, source) => samples.push({ t: performance.now(), event, source, ...box(), focus: document.activeElement?.className ?? null, content: !!drawer.querySelector(':scope > :not(.close)') });
  const click = (el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
  const advance = async (done) => { for (let i = 0; i < 600; i++) { slow(); await frame(); log('frame'); if (done()) return; } };

  const finished = async () => {
    await frame();
    await Promise.all(document.getAnimations().filter(a => a.effect?.target === drawer).map(a => a.finished.catch(() => {})));
    await frame(); await frame();
  };

  // Endpoints, read once from a settled open and a settled close: the closed edge is the viewport's right edge.
  row().focus();
  open();
  await finished();
  const targetLeft = box().left;
  const closedLeft = innerWidth;
  click(drawer.querySelector('.close'));
  await finished();
  const retargets = [];
  const reverse = async (destination, source) => {
    const before = document.getAnimations().filter(a => a.effect?.target === drawer);
    before.forEach(a => a.pause());
    const was = box();
    log('before-retarget', source);
    destination();
    await Promise.resolve();
    const after = document.getAnimations().filter(a => a.effect?.target === drawer);
    after.forEach(a => a.pause());
    const now = box();
    retargets.push({ source, was, now, dx: Math.abs(was.left - now.left) });
    log('after-retarget', source);
    after.forEach(a => a.play());
  };

  // 50% displaced on the way open, from the closed edge.
  open(); slow();
  await advance(() => Math.abs(closedLeft - box().left) >= Math.abs(closedLeft - targetLeft) / 2);
  await reverse(() => click(drawer.querySelector('.close')), 'pointer');
  await advance(() => Math.abs(closedLeft - box().left) <= Math.abs(closedLeft - targetLeft) / 4);
  await reverse(() => { row().focus(); open(); }, 'pointer');
  await frame(); slow();
  log('reopened', 'pointer');
  drawer.querySelector('.close').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
  log('escape', 'key');
  await frame();
  log('escape+1frame', 'key');
  return { closedLeft, targetLeft, retargets, samples };
})()`;

for (const variant of [{ name: "normal", rate: 1, reduced: false }, { name: "quarter", rate: 0.25, reduced: false }, { name: "reduced", rate: 1, reduced: true }]) {
  rendered(`u3010b_rendered_drawer_${variant.name}`, async () => {
    const directory = join(art!, "head");
    mkdirSync(directory, { recursive: true });

    for (const run of [1, 2, 3]) {
      await browser("set", "viewport", "1512", "950");
      await browser("set", "media", "dark", ...(variant.reduced ? ["reduced-motion"] : []));
      const url = `${rig.server.resolvedUrls.local[0]}harness.html?seed=tree-40`;
      await browser("open", url);
      await browser("wait", ".shelf-tabs");
      await evaluate(`(() => { localStorage.clear(); return true; })()`);
      await browser("open", url);
      await browser("wait", ".shelf-tabs");
      await evaluate("(() => { document.querySelector('.todos-tab [data-shelf-group=unassigned][data-state=closed] [data-part=branch-control]')?.click(); return true; })()");
      await browser("wait", "--fn", "!!document.querySelector('.shelf [data-todo] button')");
      await settle();

      const result = await evaluate<{ retargets: { dx: number }[]; samples: { event: string; left: number; content: boolean; focus: string | null }[] }>(trace(variant.rate));

      writeFileSync(join(directory, `drawer-${variant.name}-run${run}.json`), JSON.stringify(result));
      await browser("screenshot", join(directory, `drawer-${variant.name}-run${run}.png`));

      const last = result.samples.at(-1)!;

      // Escape settles by the next frame: closed, no exit content, focus returned.
      expect(last.content).toBe(false);
      expect(last.left).toBeGreaterThanOrEqual(1512 - 1);
      expect(last.focus).toContain("todo-row-button");

      // Retargets continue from the displayed position, within 1 CSS px at the same animation time.
      if (!variant.reduced) for (const retarget of result.retargets) expect(retarget.dx).toBeLessThanOrEqual(1);
    }
  }, 180_000);
}

// The Shelf's reserved mode: pointer close, reversal at 50% of its width, then the same close left to run; reduced motion settles it.
const shelfTrace = (rate: number) => `(async () => {
  const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
  const shelf = document.querySelector('.shelf');
  const samples = [];
  const log = (event) => samples.push({ t: performance.now(), event, left: shelf.getBoundingClientRect().left, width: shelf.getBoundingClientRect().width, hidden: shelf.hidden });
  const toggle = () => document.querySelector('.shelf-tab[data-selected]').dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
  const slow = () => document.getAnimations().forEach(a => { a.playbackRate = ${rate}; });
  const settled = async () => { await frame(); await Promise.all(document.getAnimations().filter(a => a.effect?.target?.matches?.('.shelf, .shelf-scrim, .columns')).map(a => a.finished.catch(() => {}))); await frame(); await frame(); };
  const openWidth = shelf.getBoundingClientRect().width;
  const openLeft = shelf.getBoundingClientRect().left;
  const moved = () => Math.abs(shelf.getBoundingClientRect().left - openLeft);
  const advance = async (done) => { for (let i = 0; i < 600; i++) { slow(); await frame(); log('frame'); if (done()) return; } };

  toggle(); slow();
  await advance(() => moved() >= openWidth / 2);
  log('reverse'); toggle(); slow();
  await advance(() => moved() <= openWidth / 4);
  await settled();
  log('settled-open');
  return { openLeft, samples };
})()`;

for (const variant of [{ name: "normal", rate: 1, reduced: false }, { name: "quarter", rate: 0.25, reduced: false }, { name: "reduced", rate: 1, reduced: true }]) {
  rendered(`u3010b_rendered_shelf_${variant.name}`, async () => {
    const directory = join(art!, "head");
    mkdirSync(directory, { recursive: true });

    for (const run of [1, 2, 3]) {
      await browser("set", "viewport", "1512", "950");
      await browser("set", "media", "dark", ...(variant.reduced ? ["reduced-motion"] : []));
      const url = `${rig.server.resolvedUrls.local[0]}harness.html?seed=tree-40`;
      await browser("open", url);
      await browser("wait", ".shelf-tabs");
      await evaluate(`(() => { localStorage.clear(); return true; })()`);
      await browser("open", url);
      await browser("wait", ".shelf-tabs");
      await settle();

      const result = await evaluate<{ openLeft: number; samples: { event: string; left: number }[] }>(shelfTrace(variant.rate));

      writeFileSync(join(directory, `shelf-${variant.name}-run${run}.json`), JSON.stringify(result));

      // The reversal ends at the open edge, never restarting from an endpoint.
      expect(result.samples.at(-1)!.left).toBe(result.openLeft);
    }
  }, 180_000);
}
