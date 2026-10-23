import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { captureDir } from "./captures";
import { expect, it } from "vitest";
import { openLane } from "../todos/laneBrowser";

it("u3528_keys_and_pointer_never_draw_rings_or_pressed_backgrounds", async () => {
  for (const scheme of ["light", "dark"] as const) {
    const lane = await openLane(1512, scheme, "u3528");
    const dir = scheme === "dark" ? captureDir("U3528") : null;

    if (dir) {
      mkdirSync(dir, { recursive: true });
      await lane.browser("record", "start", join(dir, "interaction.webm"));
      await lane.browser("set", "viewport", "1512", "950");
      await lane.browser("set", "media", "dark");
      await lane.until("!!document.querySelector('.shelf-tabs')");
    }

    try {
      const pads = "#shelf-tab-pads";
      const focused = (selector: string) => `document.activeElement === document.querySelector(${JSON.stringify(selector)})`;
      const capture = async (step: string) => { if (scheme === "dark") await lane.capture("U3528", step); };

      const ring = async () => {
        const sites = await lane.evaluate<string[]>(`(() => {
          const sample = document.createElement('div');
          sample.style.boxShadow = 'var(--shadow-drawer)';
          document.body.append(sample);
          const depth = getComputedStyle(sample).boxShadow;
          sample.remove();
          const active = document.activeElement;
          const sites = active === document.body ? [active] : [active, ...active.querySelectorAll('*')];
          if (active.closest('.app-checkbox')) sites.push(active.closest('.app-checkbox'), ...active.closest('.app-checkbox').querySelectorAll('*'));
          const panel = active.closest('.app-menu, .app-dialog, .import-panel, .bubble-frame, .bubble, .decision-card');
          if (panel) sites.push(panel);
          return sites.flatMap(el => [null, '::before', '::after'].flatMap(pseudo => {
            const style = getComputedStyle(el, pseudo);
            return [(style.outlineStyle === 'none' || parseFloat(style.outlineWidth) === 0) && (style.boxShadow === 'none' || (!pseudo && el.matches('.owner-picker, .app-dialog, .import-panel, .bubble') && style.boxShadow === depth)) ? 'none' : el.className + ':' + style.outline + ':' + style.boxShadow];
          }));
        })()`);

        expect(sites).toEqual(sites.map(() => "none"));
      };

      await ring();
      await lane.browser("click", pads);
      await lane.until(focused(pads));
      await ring();
      await capture("shelf-click");
      // Observe during real keydown as well as after release: a keydown-only ring must fail.
      await lane.evaluate(`(() => {
        window.__modifierPaint = [];
        window.addEventListener('keydown', event => {
          if (!['Control', 'Meta', 'Alt', 'Shift'].includes(event.key)) return;
          queueMicrotask(() => {
            const style = getComputedStyle(document.activeElement);
            window.__modifierPaint.push({ key: event.key, outline: style.outlineStyle === 'none' || parseFloat(style.outlineWidth) === 0, shadow: style.boxShadow });
          });
        });
        return true;
      })()`);

      for (const key of ['Control', 'Meta', 'Alt', 'Shift']) {
        await lane.browser('press', key);
        await lane.until(focused(pads));
        await ring();
      }

      expect(await lane.evaluate('window.__modifierPaint')).toEqual(['Control', 'Meta', 'Alt', 'Shift'].map(key => ({ key, outline: true, shadow: 'none' })));

      if (dir) writeFileSync(join(dir, "modifiers.json"), JSON.stringify(await lane.evaluate("window.__modifierPaint")) + "\n");

      await lane.browser("press", "ArrowLeft");
      await lane.until(focused("#shelf-tab-todos"));
      await ring();
      await lane.browser("press", "Tab");
      await lane.until("!!document.activeElement.closest('.shelf')");
      await lane.browser("press", "Shift+Tab");
      await lane.until(focused("#shelf-tab-todos"));
      await ring();
      await capture("shelf-keyboard");
      await lane.browser("click", pads);
      await lane.until(focused(pads));
      await ring();

      // Real pointer and Tab navigation, with no synthetic focus or replacement controls.
      for (const [selector, step] of [
        ['.project-tab .tab-name-button', 'project-tab'],
        ['.rail [data-id="tokens"].rail-row', 'rail-row'],
        ['.rail [data-id="tokens"] [aria-label="Open folder"]', 'icon-button'],
        ['.strip-add', 'button'],
      ]) {
        await lane.browser("click", selector!);
        await lane.until(focused(selector!));
        await ring();
        await capture(step!);
        await lane.browser("press", step === "rail-row" ? "ArrowUp" : "Shift+Tab");
        await lane.until(`!(${focused(selector!)})`);

        await ring();

        if (step === "rail-row") {
          await lane.until(focused('.rail [data-id="auth"].rail-row'));
          await lane.browser("press", "ArrowDown");
          await lane.until(focused(selector!));
          await ring();
          await lane.browser("press", "Tab");
          await lane.until(focused('.rail [data-id="tokens"] [aria-label="Stop"]'));
          await ring();
          await lane.browser("press", "Shift+Tab");
        }
        else {
          // Focusing a Project tab reveals its close control, which becomes an intervening Tab stop.
          for (let stop = 0; stop < 8 && !(await lane.evaluate<boolean>(focused(selector!))); stop++) {
            await lane.browser("press", "Tab");
          }
        }

        await lane.until(focused(selector!));
        await ring();
      }

      // Overview mounts the library combobox, including its scripted focus.
      await lane.browser("click", ".todo-project-root");
      await lane.until(focused(".todo-project-root"));
      await ring();

      await lane.browser("click", ".ask-input");
      await lane.until(focused(".ask-input"));
      await ring();
      await capture("ask-click");

      for (const key of ["a", "ArrowLeft", "Backspace", "Control+a", "Alt+a"]) {
        await lane.browser("press", key);
        expect(await lane.evaluate<boolean>(focused(".ask-input"))).toBe(true);
        await ring();
      }

      await capture("ask-typing");
      await lane.browser("press", "Tab");
      await lane.until(`!(${focused(".ask-input")})`);
      await ring();

      // Confirmations are native (U3512a); Capture retains the shared web dialog's focus path.
      await lane.browser("press", "Meta+Shift+t");
      const field = '.capture .capture-field';

      await lane.until(focused(field));
      await ring();
      await lane.browser("press", "Tab");
      await lane.until(`!(${focused(field)})`);
      await ring();
      await lane.browser("press", "Shift+Tab");
      await lane.until(focused(field));
      await ring();
      await capture("keyboard-dialog");
      await lane.browser("press", "Escape");
      await lane.until("!document.querySelector('.capture')");

      for (const opener of ['[aria-label="Add Workstream"]', '.terminal-new']) {
        await lane.browser("click", opener);
        await lane.until("document.activeElement?.matches('.xterm-helper-textarea')");
        await ring();
        // A modified App shortcut opens and focuses another Terminal, including after pointer-driven Terminal focus.
        const previous = await lane.evaluate<string>("document.activeElement.closest('[data-bubble]')?.dataset.bubble ?? 'pane'");

        await lane.browser("press", "Meta+t");
        await lane.until(`document.activeElement?.matches('.xterm-helper-textarea') && document.activeElement.closest('[data-bubble]')?.dataset.bubble !== ${JSON.stringify(previous)}`);
        await ring();
      }

      const terminalTab = '.terminal-tab-pair:last-of-type .terminal-tab';
      await lane.browser("click", terminalTab);
      await lane.until(focused(terminalTab));
      await ring();
      await capture("terminal-tab");
      await lane.browser("press", "Shift+Tab");
      await lane.until(`!(${focused(terminalTab)})`);
      await lane.browser("press", "Tab");
      await lane.until(focused(terminalTab));
      await ring();

      await lane.browser("reload");
      await lane.until("!!document.querySelector('.shelf-tabs')");
      await lane.browser("press", "Tab");
      await lane.until(focused(".project-tab .tab-name-button"));
      await ring();
      await lane.browser("click", ".strip-add");
      await lane.until(focused(".strip-add"));
      await ring();
      await lane.browser("reload");
      await lane.until("!!document.querySelector('.rail-import')");

      if (!(await lane.evaluate<boolean>("document.querySelector('#shelf-tab-todos')?.getAttribute('aria-expanded') === 'true'"))) await lane.browser("click", "#shelf-tab-todos");

      await lane.browser("click", ".todo-project-root");
      const closed = '.shelf [data-shelf-group="unassigned"][data-state="closed"] [data-part="branch-control"]';

      if (await lane.evaluate<boolean>(`!!document.querySelector(${JSON.stringify(closed)})`)) await lane.browser("click", closed);
      await lane.until("!!document.querySelector('.shelf [data-todo=\"5\"] .todo-row-button')");
      await lane.browser("focus", '.shelf [data-todo="5"] .todo-row-button');
      await lane.browser("press", "t");
      await lane.until("document.querySelector('.shelf')?.getAttribute('data-triage') === 'on'");
      await lane.browser("press", "w");
      await lane.until("!!document.querySelector('.app-menu')");
      await lane.browser("press", "ArrowDown");
      await lane.until("document.activeElement?.closest('.app-menu') && !!document.querySelector('[role=menuitem][data-highlighted]')");
      await ring();
      await lane.browser("press", "Escape");
      await lane.until("!document.querySelector('.app-menu')");
      await lane.browser("press", "Escape");
      await lane.until("document.querySelector('.shelf')?.getAttribute('data-triage') !== 'on'");
      await lane.evaluate(`(async () => {
        const app = window.__fake.app;
        const nodes = await app.rpc('rail.tree', null);
        app.handlers['rail.tree'] = () => structuredClone(nodes);
        app.handlers['workstream.setAuto'] = ({ id, auto }) => {
          nodes.find(node => node.id === id).auto = auto;
          window.__fake.emit({ actor: { kind: 'user', id: 'you', parent: null }, name: 'workstream.updated', data: { id, auto } });
          return null;
        };
        return true;
      })()`);
      // The selected Workstream exposes the board's real controlled Auto switch.
      await lane.browser("click", '.rail [data-id="backend"] [data-part="branch-control"]');
      await lane.until("!!document.querySelector('.todo-auto [role=switch]')");
      const auto = '.todo-auto [role=switch]';
      const backgrounds = () => lane.evaluate<string[]>(`[document.querySelector('${auto}'), ...document.querySelector('.todo-auto .app-switch').querySelectorAll('*'), document.querySelector('.todo-auto .app-switch')].flatMap(el => [null, '::before', '::after'].map(pseudo => { const s = getComputedStyle(el, pseudo); return s.backgroundColor + '|' + s.backgroundImage; }))`);
      const before = await backgrounds();
      const checked = await lane.evaluate<string>(`document.querySelector('${auto}').getAttribute('aria-checked')`);
      const box = await lane.evaluate<{ x: number; y: number }>(`(() => { const r = document.querySelector('${auto}').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);

      await lane.resetCalls();
      await lane.browser("mouse", "move", String(Math.round(box.x)), String(Math.round(box.y)));
      await lane.browser("mouse", "down");
      expect(await backgrounds()).toEqual(before);
      await ring();
      await capture("auto-held");
      await lane.browser("mouse", "up");
      await lane.until(`document.querySelector('${auto}').getAttribute('aria-checked') !== ${JSON.stringify(checked)}`);
      expect(await lane.calls("workstream.setAuto")).toHaveLength(1);
      await capture("auto-changed");

      if (dir) {
        await lane.evaluate("window.__fake.failNext(-32003, 'Supervisor unavailable; start it and retry')");
        await lane.browser("click", auto);
        await lane.until("!!document.querySelector('.todo-auto [role=alert]')");
        await capture("dense-failure");
      }

      await lane.browser("click", ".rail-import");
      await lane.until("!!document.activeElement.closest('.import-panel')");
      await ring();
      await capture("import-dialog");
      await lane.browser("press", "Escape");
      await lane.until("!document.querySelector('.import-panel')");

      const url = await lane.evaluate<string>("location.href");

      await lane.browser("open", url.replace('seed=tree-40', 'seed=decisions'));
      await lane.until("!!document.querySelector('.decision-card button')");
      await lane.browser("focus", ".decision-card button");
      await lane.until("!!document.activeElement.closest('.decision-card')");
      await ring();
      await capture("decision");
    } finally {
      try { if (dir) await lane.browser("record", "stop"); } finally { await lane.close(); }
    }
  }
}, 240_000);
