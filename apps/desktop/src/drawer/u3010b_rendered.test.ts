import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { captureDir } from "../testing/captures";
import { shelfBrowser } from "../shelf/u371Browser";

/**
 * U3010b's rendered observer: the Inbox Drawer pointer open, reversal at 50% displaced, reopen at 50% of the return, then Escape,
 * in dark 1512×950 on `tree-40`. Raw timestamped boxes go to `captureDir("U3010b")` for the design critic; docs/motion.md
 * names the protocol. Quarter speed is `Animation.playbackRate`, never a longer Token.
 */
vi.setConfig({ testTimeout: 60_000 });

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
  await browser("click", '.rail [data-id="tokens"] .row-state');
  await browser("wait", ".xterm-screen");
  await settle();
  await evaluate("(() => { document.querySelector('.todos-tab [data-shelf-group=unassigned][data-state=closed] [data-part=branch-control]')?.click(); return true; })()");
  await browser("wait", ".shelf [data-todo] .todo-row-button");
  await browser("click", ".shelf [data-todo] .todo-row-button");
  await settle();
  // U4698a: a Todo opens filled; U430's narrowing, and so its resize, belongs to the side state, which the Project keeps once chosen.
  await browser("press", "Enter");
  await settle();
  await browser("click", '.drawer button[aria-label="Restore"]');
  await settle();
  await browser("click", ".drawer .close");
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

  for (const [selector, count] of [['.shelf [data-todo] .todo-row-button', 1], [".drawer .close", 2]] as const) {
    await browser("click", selector);

    if (count === 1) await browser("press", "Enter");
    await settle();
    expect(await evaluate("window.__drawerResizes.length")).toBe(count);
  }

  expect(await evaluate(`(() => {
    cancelAnimationFrame(window.__drawerResizeFrame);
    return { counts: [...new Set(window.__drawerResizeFrames)], ids: window.__drawerResizes.map(call => call.params.id), sliding: window.__drawerResizes.map(call => call.sliding) };
  })()`)).toEqual({ counts: [0, 1, 2], ids: ["t-tokens", "t-tokens"], sliding: [false, false] });
});

// Trusted input observes the actual hairline target; padding is not a dismissal target.
// Hit testing belongs to this rendered observer, rather than the behavioral App tests.
for (const mode of ["reserved", "overlay"]) for (const rate of [1, 0.25]) {
rendered(`u3010b_pointer_targets_remain_reachable_during_reversal_${mode}_${rate}`, { retry: 0, timeout: 180_000 }, async () => {
  const directory = join(art!, "hairline");
  mkdirSync(directory, { recursive: true });

  for (const run of (rate === 1 ? [1, 2, 3] : [1])) {
    await openShelf("tree-40", mode === "overlay" ? 480 : 288, mode === "overlay" ? 560 : 320, 1512, "dark");
    await browser("set", "viewport", "1512", "950");
    const name = `pointer-${mode}-${rate}-run${run}`;

    await browser("set", "media", "dark");

    await browser("wait", ".shelf-tabs");

    if (mode === "overlay") {
      // U371's full-viewport fixture needs a resize after the floor changes so Layout measures its placement.
      await evaluate("document.documentElement.style.setProperty('--centre-min-width', String(parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--space-6')) * 42) + 'px')");
      await browser("set", "viewport", "1512", "949");
      await browser("set", "viewport", "1512", "950");
      await settle();
    }


    await browser("click", '.rail [data-id="tokens"] .row-state');
    await browser("wait", ".xterm-screen");
    await browser("click", '.todos-tab [data-shelf-group="unassigned"] [data-part="branch-control"]');
    await browser("click", '.shelf [data-todo="1"] .todo-row-button');
    await settle();
    expect(await evaluate("matchMedia('(prefers-color-scheme: dark)').matches")).toBe(true);
    // Load the Todo's lazy content before measuring a reversal; capture still records the complete measured cycle below.
    await browser("click", '.shelf [data-todo="1"] .todo-row-button');
    await browser("press", "Enter");
    await settle();
    await browser("click", ".drawer .close");
    await settle();
    await browser("wait", "--load", "networkidle");
    expect(await evaluate("document.querySelector('.window').dataset.shelfMode")).toBe(mode);
    await evaluate(`(() => {
      const drawer = document.querySelector('.drawer');
      const terminal = document.querySelector('.xterm-screen');
      const selected = document.querySelector('.rail .rail-row[data-selected=true]');
      const todo = document.querySelector('.shelf [data-todo="1"]');
      const state = () => ({ closeLeft: drawer.querySelector('.close').getBoundingClientRect().left, closeTranslate: getComputedStyle(drawer.querySelector('.close')).translate, left: drawer.getBoundingClientRect().left, width: drawer.getBoundingClientRect().width,
        open: drawer.dataset.open, mounted: drawer.dataset.mounted, inert: drawer.inert,
        focus: document.activeElement?.className, returned: document.activeElement === todo.querySelector('.todo-row-button'), home: selected?.dataset.id, todo: todo.dataset.todo,
        sameTerminal: terminal === document.querySelector('.xterm-screen'), sameHome: selected === document.querySelector('.rail .rail-row[data-selected=true]'),
        mode: document.querySelector('.window').dataset.shelfMode });
      const samples = [];
      const events = [];
      let output = 0;
      let written = 0;
      const sample = () => {
        drawer.getAnimations({ subtree: true }).forEach(animation => { if (animation.playbackRate !== ${rate}) animation.playbackRate = ${rate}; });
        if (!samples.length || performance.now() - written >= 100) {
          written = performance.now();
          window.__fake.writeOutput('t-tokens', 'drawer pointer ' + (++output) + '\\r\\n');
        }
        samples.push({ t: performance.now(), output, ...state() });
        window.__pointerDrawer.frame = requestAnimationFrame(sample);
      };
      for (const kind of ['pointerdown', 'pointerup', 'click']) document.addEventListener(kind, event => events.push({ t: performance.now(), trusted: event.isTrusted, kind, target: event.target.outerHTML, x: event.clientX, y: event.clientY, ...state() }));
      window.__pointerDrawer = { state, samples, events, panel: drawer, terminal, selected, todo, rate: ${rate} };
      window.__pointerDrawer.frame = requestAnimationFrame(sample);
      return true;
    })()`);
    await browser("stream", "disable");
    const stream = (await browser("stream", "enable")).match(/ws:\/\/[^\s]+/)?.[0];

    if (!stream) throw new Error("agent-browser input stream unavailable");

    // Record the existing screencast once. Page.captureScreenshot's second 100 ms loop can hide an entire half-crossing.
    const frames = mkdtempSync(join(tmpdir(), "drawer-frames-"));

    // A Node process owns the stream: jsdom's Event realm cannot receive Node WebSocket events.
    const recording = spawn(process.execPath, ["--input-type=module", "-e", `
      import { writeFileSync } from 'node:fs';
      import { join } from 'node:path';
      const stamps = [];
      const socket = new WebSocket(process.argv[1]);
      socket.onmessage = event => {
        const message = JSON.parse(String(event.data));
        if (message.type !== 'frame') return;
        writeFileSync(join(process.argv[2], stamps.length + '.jpg'), Buffer.from(message.data, 'base64'));
        stamps.push(performance.now());
        if (stamps.length === 1) process.stdout.write('ready');
      };
      process.on('SIGTERM', () => {
        const list = stamps.map((stamp, index) => "file '" + index + ".jpg'\\nduration " + ((stamps[index + 1] ?? stamp + 16.667) - stamp) / 1000).join('\\n');
        writeFileSync(join(process.argv[2], 'frames.txt'), list);
        socket.close();
        process.exit(0);
      });
    `, stream, frames], { stdio: ["ignore", "pipe", "inherit"] });

    await once(recording.stdout!, "data");

    try {
      await evaluate(`(async () => {
        const o = window.__pointerDrawer;
        // agent-browser's documented input stream emits native mouse input, without locator stability waits.
        const input = new WebSocket(${JSON.stringify(stream)});
        // The stream's first rendered frame acknowledges screencast startup before input races the slide.
        await new Promise((resolve, reject) => {
          input.onerror = reject;
          input.onmessage = event => { if (JSON.parse(event.data).type === 'frame') { input.onmessage = null; resolve(); } };
        });
        const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
        const activate = async selector => {
          const target = document.querySelector(selector);
          const edge = selector === '.drawer';
          const r = (edge ? target : target.querySelector('svg') ?? target).getBoundingClientRect();
          const x = r.left + (edge ? parseFloat(getComputedStyle(target).borderLeftWidth) / 2 : r.width / 2);
          const y = r.top + r.height / 2;
          const hit = document.elementFromPoint(x, y);
          o.events.push({ phase: 'hit-test', t: performance.now(), selector, x, y, hit: hit?.outerHTML, ...o.state() });
          if (!target.contains(hit)) throw new Error('Unreachable pointer target: ' + selector);
          const clicked = new Promise(resolve => {
            const observed = event => {
              if (!edge && !target.contains(event.target)) return;
              window.removeEventListener(edge ? 'pointerdown' : 'click', observed);
              resolve({ trusted: event.isTrusted, hit: target.contains(event.target), ...o.state() });
            };
            window.addEventListener(edge ? 'pointerdown' : 'click', observed);
          });
          for (const eventType of ['mousePressed', 'mouseReleased']) input.send(JSON.stringify({ type: 'input_mouse', eventType, x, y, button: 'left', clickCount: 1 }));
          const activated = await clicked;
          if (!activated.trusted) throw new Error('Untrusted activation');
          if (!activated.hit) throw new Error('Pointer missed moving target: ' + selector);
          return activated;
        };
        // The Open chevron is gone: a trusted Enter on the focused row opens the Drawer.
        const openByEnter = async selector => {
          const target = document.querySelector(selector);
          target.focus();
          const pressed = new Promise(resolve => {
            const observed = event => { if (event.key !== 'Enter') return; window.removeEventListener('keydown', observed); resolve({ trusted: event.isTrusted, hit: target.contains(event.target), ...o.state() }); };
            window.addEventListener('keydown', observed);
          });
          for (const eventType of ['keyDown', 'keyUp']) input.send(JSON.stringify({ type: 'input_keyboard', eventType, key: 'Enter', code: 'Enter', text: eventType === 'keyDown' ? '\\r' : '', windowsVirtualKeyCode: 13 }));
          const activated = await pressed;
          if (!activated.trusted) throw new Error('Untrusted Enter');
          o.events.push({ phase: 'enter', t: performance.now(), ...activated });
          return activated;
        };
        const halfway = async (from, destination) => {
          while (o.panel.getAnimations().some(animation => animation.playState === 'running')) {
            o.panel.getAnimations({ subtree: true }).forEach(a => { if (a.playbackRate !== o.rate) a.playbackRate = o.rate; });
            await frame();
            const left = o.state().left;
            if (Math.abs(left - from) >= Math.abs(destination - from) / 2) {
              if (Math.abs(left - destination) < 1) throw new Error('missed half crossing');
              o.events.push({ phase: 'half-crossing', t: performance.now(), from, destination, ...o.state() });
              return left;
            }
          }
          throw new Error('no half crossing');
        };
        try {
          const initial = o.state();
          await openByEnter('.shelf [data-todo="1"] .todo-row-button');
          await halfway(initial.left, initial.left - initial.width);
          const closed = await activate('.drawer');
          if (closed.open !== 'false') throw new Error('Visible edge press did not dismiss Drawer');
          if (Math.abs(closed.left - (initial.left - initial.width)) < 1) throw new Error('Edge press arrived after opening settled');
          const returning = closed.left;
          await halfway(returning, initial.left);
          const reopened = await openByEnter('.shelf [data-todo="1"] .todo-row-button');
          if (Math.abs(reopened.left - initial.left) < 1) throw new Error('Reopen arrived after return settled');
          await frame();
          const escaped = new Promise(resolve => document.addEventListener('keyup', event => { if (event.key === 'Escape') resolve(event.isTrusted); }, { once: true }));
          o.events.push({ phase: 'escape', t: performance.now(), ...o.state() });
          for (const eventType of ['keyDown', 'keyUp']) input.send(JSON.stringify({ type: 'input_keyboard', eventType, key: 'Escape', code: 'Escape', text: '', windowsVirtualKeyCode: 27 }));
          if (!await escaped) throw new Error('Untrusted Escape');
          await frame();
          o.events.push({ phase: 'escape+1frame', t: performance.now(), ...o.state() });
          if (o.state().open !== 'false' || o.state().mounted !== 'false') throw new Error('Escape did not settle by next frame');
        } finally { input.close(); }
        return true;
      })()`);

      await settle();
      const state = await evaluate("window.__pointerDrawer.state()");
      expect(state).toMatchObject({ open: "false", mounted: "false", sameTerminal: true, sameHome: true, returned: true, home: "tokens", todo: "1", mode });
      expect(await evaluate("window.__pointerDrawer.events.filter(event => !event.phase).every(event => event.trusted)")).toBe(true);
      const checks = await evaluate<Record<string, { status: string }>>("window.__checks()");

      for (const id of ["D2", "D5", "D6"]) expect(checks[id]?.status).toBe("pass");
      writeFileSync(join(directory, `${name}.checks.json`), JSON.stringify(checks));
      await browser("click", '.shelf [data-todo="1"] .todo-row-button');
      await browser("press", "Enter");
      await settle();
      await browser("screenshot", join(directory, `${name}.png`));
      const openChecks = await evaluate<Record<string, { status: string }>>("window.__checks()");

      for (const id of ["D2", "D5", "D6"]) expect(openChecks[id]?.status).toBe("pass");
      writeFileSync(join(directory, `${name}-open.checks.json`), JSON.stringify(openChecks));

      if (run === 1 && rate === 1) {
        await evaluate(`(async () => {
          const { RpcError } = await import('/src/app/seam.ts');
          window.__fake.app.handlers['todo.comment'] = () => { throw new RpcError(-32003, 'Comment refused. Retry when the connection is restored.'); };
          return true;
        })()`);
        await browser("fill", ".drawer .todo-comment-field", "Preserve this exact unsubmitted comment.");
        await browser("press", "Enter");
        await browser("wait", "--fn", "document.querySelector('.drawer').textContent.includes('Comment refused.')");
        await browser("screenshot", join(directory, `${name}-refused.png`));
        const failureChecks = await evaluate<Record<string, { status: string }>>("window.__checks()");

        for (const id of ["D2", "D5", "D6"]) expect(failureChecks[id]?.status).toBe("pass");
        writeFileSync(join(directory, `${name}-refused.checks.json`), JSON.stringify(failureChecks));
      }
    } finally {
      const trace = await evaluate("(() => { const o = window.__pointerDrawer; cancelAnimationFrame(o.frame); return { samples: o.samples, events: o.events }; })()");
      writeFileSync(join(directory, `${name}-frames.json`), JSON.stringify(trace));
      recording.kill("SIGTERM");
      await once(recording, "exit");
      execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", join(frames, "frames.txt"), "-fps_mode", "vfr", "-c:v", "libvpx-vp9", "-deadline", "realtime", "-cpu-used", "8", join(directory, `${name}.webm`)]);
      rmSync(frames, { recursive: true });
      // openShelf navigates to a fresh fixture; the file hook closes its isolated browser.
    }
  }
});
}

// A missed press beside Todo content must not become a dismissal command.
it("u3010b_panel_edge_press_preserves_the_open_todo", { retry: 0 }, async () => {
  await openShelf("tree-40", 288, 320, 1512, "dark");
  await browser("set", "viewport", "1512", "950");
  await browser("click", '.todos-tab [data-shelf-group="unassigned"] [data-part="branch-control"]');
  await browser("click", '.shelf [data-todo="5"] .todo-row-button');
  await settle();
  await browser("click", '.shelf [data-todo="5"] .todo-row-button');
  await browser("press", "Enter");
  await settle();
  await browser("click", '.drawer button[aria-label="Restore"]');
  await settle();
  await evaluate(`(() => {
    const panel = document.querySelector('.drawer');
    window.__edgeContent = panel.lastElementChild;
    document.addEventListener('pointerdown', event => {
      window.__edgePress = { trusted: event.isTrusted, panel: event.target === panel };
    }, { once: true });
    return true;
  })()`);
  const point = await evaluate<{ x: number; y: number }>(`(() => { const panel = document.querySelector('.drawer'); const r = panel.getBoundingClientRect(); return { x: r.left + parseFloat(getComputedStyle(panel).borderLeftWidth) / 2, y: r.top + r.height / 2 }; })()`);
  await browser("mouse", "move", String(Math.floor(point.x)), String(Math.floor(point.y)));
  await browser("mouse", "down");
  await browser("mouse", "up");
  await settle();
  expect(await evaluate(`(() => {
    const panel = document.querySelector('.drawer');
    return { ...window.__edgePress, open: panel.dataset.open, sameContent: panel.lastElementChild === window.__edgeContent };
  })()`)).toEqual({ trusted: true, panel: true, open: "true", sameContent: true });

  if (art) {
    const directory = join(art, "hairline/padding");
    mkdirSync(directory, { recursive: true });
    await browser("screenshot", join(directory, "todo-5-edge-press.png"));
    writeFileSync(join(directory, "todo-5-edge-press.checks.json"), JSON.stringify(await evaluate("window.__checks()")));
    writeFileSync(join(directory, "todo-5-edge.json"), JSON.stringify(await evaluate(`(() => {
      const panel = document.querySelector('.drawer');
      const border = getComputedStyle(panel);
      const pseudo = getComputedStyle(panel, '::before');
      return { press: window.__edgePress, open: panel.dataset.open, left: panel.getBoundingClientRect().left,
        borderWidth: border.borderLeftWidth, borderColor: border.borderLeftColor,
        pseudoContent: pseudo.content, pseudoBorderWidth: pseudo.borderLeftWidth };
    })()`)));
    await evaluate(`(async () => {
      const { RpcError } = await import('/src/app/seam.ts');
      window.__fake.app.handlers['todo.comment'] = () => { throw new RpcError(-32003, 'Comment refused. Retry when the connection is restored.'); };
      return true;
    })()`);
    await browser("fill", ".drawer .todo-comment-field", "Preserve this exact unsubmitted comment.");
    await browser("press", "Enter");
    await browser("wait", "--fn", "document.querySelector('.drawer').textContent.includes('Comment refused.')");
    await browser("screenshot", join(directory, "todo-5-refused.png"));
    writeFileSync(join(directory, "todo-5-refused.checks.json"), JSON.stringify(await evaluate("window.__checks()")));
  }
});

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
