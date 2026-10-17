import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { chromePath, FULLSCREEN, openPage } from "./chromePage";
import type { ChromePage } from "./chromePage";
import { captureDir } from "./captures";

/** U3704 in a real Chromium: jsdom has no layout, so where a state sits against its name and the row's actions is read from the rendered boxes. */

const found = chromePath();

// A missing browser skips only off CI: on CI the claim must be checked, never silently dropped.
const run = found || process.env["CI"] ? describe : describe.skip;

let page: ChromePage;

const ART = captureDir("U3704");

beforeAll(async () => {
  if (!found) throw new Error("U3704 needs a Chrome binary: set CHROME_PATH");

  page = await openPage(found);
}, 90_000);

afterAll(async () => {
  await page?.close();
});

type Box = { left: number; right: number; top: number; bottom: number; width: number; height: number };

type StateRead = Box & { role: string | null; tabindex: string | null; tag: string; cursor: string; background: string; display: string; visibility: string; opacity: number; clip: string };

type Read = {
  label: string;
  states: StateRead[];
  name: Box | null;
  actions: (Box & { label: string; chevron: boolean })[];
  space2: number;
  space3: number;
};

/** The surfaces of the scenario, each a selector for the row, tab or bar that holds states. */
const ROW = ".rail-row, [data-flat-tab], .bubble-header, .shelf-row, .switcher-item";

/** Page-side: marks every row, tab or bar that holds an outermost `data-state` and returns what each is. */
const FIND = `() => {
  const rows = [];
  const states = [...document.querySelectorAll(${JSON.stringify('[data-state]:not([data-scope])')})].filter((own) => !own.parentElement.closest(${JSON.stringify('[data-state]:not([data-scope])')}));
  for (const state of states) {
    if (state.getBoundingClientRect().width === 0) continue;
    const row = state.closest(${JSON.stringify(ROW)});
    if (!row) { rows.push({ index: -1, label: "no row holds " + state.outerHTML.slice(0, 80) }); continue; }
    if (!rows.some((known) => known.row === row)) rows.push({ row, label: (row.className || row.tagName) + " " + (row.getAttribute("data-id") || row.getAttribute("data-bubble") || row.textContent.trim().slice(0, 24)) });
  }
  window.__u3704 = rows.map((own) => own.row).filter(Boolean);
  return rows.map((own) => own.row ? { index: window.__u3704.indexOf(own.row), label: own.label } : own);
}`;

/** Page-side: the point the pointer goes to for row `index` and the element focus goes to. */
const AIM = `(index) => {
  const row = window.__u3704[index];
  row.scrollIntoView({ block: "center" });
  const name = row.querySelector(".name, .terminal-tab-name, .bubble-name, .shelf-title");
  const box = (name ?? row).getBoundingClientRect();
  return { x: box.left + Math.min(box.width / 2, 20), y: box.top + box.height / 2 };
}`;

const FOCUS = `(index) => {
  const row = window.__u3704[index];
  const target = row.matches("[tabindex]") ? row : row.querySelector("button, [tabindex]") ?? row;
  target.focus();
}`;

/** A tick box whose value is the state is the state's own control, so it is no action: it is left out of the actions here. */
const READ = `(index) => {
  const row = window.__u3704[index];
  const box = (el) => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; };
  const probe = (name) => { const el = document.createElement("div"); el.style.cssText = "position:absolute;visibility:hidden;width:var(" + name + ")"; document.body.append(el); const w = el.getBoundingClientRect().width; el.remove(); return w; };
  const states = [...row.querySelectorAll('[data-state]:not([data-scope])')].filter((own) => !own.parentElement.closest(${JSON.stringify('[data-state]:not([data-scope])')}));
  const nameEl = row.querySelector(".name, .terminal-tab-name, .bubble-name, .shelf-title");
  let name = null;
  if (nameEl) {
    const full = box(nameEl);
    const range = document.createRange();
    range.selectNodeContents(nameEl);
    const text = range.getBoundingClientRect();
    name = { ...full, right: Math.min(full.right, text.right) };
  }
  const seen = (el) => { let own = 1; for (let node = el; node && node !== row.parentElement; node = node.parentElement) own *= Number(getComputedStyle(node).opacity); return own; };
  const shows = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility === "visible" && s.display !== "none" && seen(el) > 0; };
  const actions = [...row.querySelectorAll('button, [role="button"], input[type="checkbox"]')]
    .filter((own) => !own.matches('input[type="checkbox"]') && !states.some((state) => own.contains(state)) && !(nameEl && own.contains(nameEl)) && !states.some((state) => state.contains(own)) && shows(own))
    .map((own) => ({ ...box(own), label: own.getAttribute("aria-label") || own.className, chevron: own.classList.contains("rail-chevron") }));
  return {
    label: "",
    states: states.map((own) => { const s = getComputedStyle(own); return { ...box(own), role: own.getAttribute("role"), tabindex: own.getAttribute("tabindex"), tag: own.tagName, cursor: s.cursor, background: s.backgroundColor, display: s.display, visibility: s.visibility, opacity: Number(s.opacity), clip: s.clip + "|" + s.clipPath }; }),
    name, actions, space2: probe("--space-2"), space3: probe("--space-3"),
  };
}`;

/** Page-side: what a seed needs before its tabs and bars show. */
const OPEN_TERMINALS = `async () => {
  document.querySelector('[data-id="runner"]')?.click();
  for (let n = 0; n < 100 && document.querySelectorAll(".terminal-tab-pair").length < 2; n++) await new Promise((done) => setTimeout(done, 50));
  if (!document.querySelector(".terminal-tab-pair[data-selected=true]")) document.querySelector(".terminal-tab").click();
  await new Promise((done) => setTimeout(done, 300));
}`;

/** Page-side: a Todo that waits on another, so the Shelf holds a row with a `blocked` Glyph (U347: the Shelf lists what a running Agent owns). */
const BLOCKED_TODO = `async () => {
  const app = window.__fake.app;
  window.__fake.actAs({ kind: "agent", id: "agent-1", parent: null });
  const first = await app.rpc("todo.create", { title: "first thing", body: null, blockers: null });
  await app.rpc("todo.create", { title: "second thing waits on the first", body: null, blockers: [first.id] });
  await new Promise((done) => setTimeout(done, 500));
}`;

/** Page-side: a Door that fails to start, so its row shows the failed Glyph beside the name and Retry at the trailing edge. */
const FAILED_DOOR = `async () => {
  window.__fake.failNext(-32003, "no room");
  document.querySelector(".door-action").click();
  await new Promise((done) => setTimeout(done, 500));
  if (!document.querySelector('.rail-row [data-state="error"]')) throw new Error("the failed Door shows no failed Glyph");
}`;

const SURFACES: { seed: string; before?: string; again?: string; rows?: string[] }[] = [
  { seed: "tree-40", before: BLOCKED_TODO, rows: ["shelf-row", "todo-row"] },
  { seed: "agents-10" },
  { seed: "door-stopped", before: FAILED_DOOR },
  { seed: "tabs-8" },
  { seed: "bubbles", before: OPEN_TERMINALS, again: OPEN_TERMINALS, rows: ["bubble-header", "terminal-tab-pair"] },
];

type Rest = Read;

const judge = (where: string, rest: Rest, read: Read, mode: string): string[] => {
  const fails: string[] = [];
  const at = `${where} ${mode}`;
  const { space2, space3 } = read;
  /** The gaps between actions that follow one another on one line. */

  const gaps = (boxes: Box[]) => {
    const sorted = boxes.slice().sort((a, b) => a.left - b.left);

    return sorted.slice(1).flatMap((own, n) => {
      const before = sorted[n]!;

      return own.top < before.bottom && own.bottom > before.top && own.left >= before.right ? [own.left - before.right] : [];
    });
  };

  const between = read.actions.filter((own) => !own.chevron);
  const spacing = Math.max(0, ...gaps(between));

  read.states.forEach((state, n) => {
    const own = `${at} state ${n}`;
    const before = rest.states[n];

    // 2: with its name: reached from the name through states that follow one another, each within the gap.
    if (read.name) {
      const right = read.states.filter((other) => other.left >= read.name!.right - 0.5).sort((a, b) => a.left - b.left);
      const left = read.states.filter((other) => other.right <= read.name!.left + 0.5).sort((a, b) => b.right - a.right);
      let edge = right.includes(state) ? read.name.right : read.name.left;
      let gap = 0;

      for (const other of right.includes(state) ? right : left) {
        gap = right.includes(state) ? other.left - edge : edge - other.right;
        edge = right.includes(state) ? other.right : other.left;

        if (other === state || gap > space2 + 0.5) break;
      }

      if (gap > space2 + 0.5) fails.push(`${own}: ${gap.toFixed(1)}px from its name, over ${space2}`);

      const lo = state.left >= read.name.right ? read.name.right : state.right;
      const hi = state.left >= read.name.right ? state.left : read.name.left;

      for (const action of read.actions) if (action.left >= lo - 0.5 && action.right <= hi + 0.5 && action.top < state.bottom && action.bottom > state.top) fails.push(`${own}: ${action.label} lies between it and its name`);
    }

    // 3: apart.
    const near = read.actions.length ? Math.min(...read.actions.map((action) => Math.hypot(Math.max(0, action.left - state.right, state.left - action.right), Math.max(0, action.top - state.bottom, state.top - action.bottom)))) : Infinity;
    const need = Math.max(2 * spacing, space3);

    if (near < need - 0.5) fails.push(`${own}: ${near.toFixed(1)}px from the nearest action, under ${need}`);

    // 4: actions trail.
    for (const action of read.actions) if (!action.chevron && action.left < state.right - 0.5) fails.push(`${own}: ${action.label} is left of it`);

    // 5: never a control.
    if (state.role === "button" || ["BUTTON", "A", "INPUT"].includes(state.tag)) fails.push(`${own}: is a control (${state.tag} ${state.role})`);

    if (state.tabindex !== null && state.tabindex !== "-1") fails.push(`${own}: is a tab stop`);

    if (state.cursor === "pointer") fails.push(`${own}: has a pointer cursor`);

    if (before && state.background !== before.background) fails.push(`${own}: background ${before.background} became ${state.background}`);

    if (Math.round(state.width) === 24 && Math.round(state.height) === 24) fails.push(`${own}: is a 24 px square like an icon button`);

    // 6: never swaps.
    if (before && (Math.abs(state.left - before.left) > 0.5 || Math.abs(state.top - before.top) > 0.5 || Math.abs(state.width - before.width) > 0.5 || Math.abs(state.height - before.height) > 0.5)) fails.push(`${own}: moved or resized from ${[before.left, before.top, before.width, before.height].map(Math.round)} to ${[state.left, state.top, state.width, state.height].map(Math.round)}`);

    if (state.display === "none" || state.visibility !== "visible" || !(state.opacity > 0) || /rect|inset|polygon|circle/.test(state.clip)) fails.push(`${own}: is hidden`);
  });

  if (rest.states.length !== read.states.length) fails.push(`${at}: ${rest.states.length} states at rest, ${read.states.length} now`);

  return fails;
};

run("u3704 state rides with the name, apart from the actions", () => {
  vi.setConfig({ testTimeout: 180_000 });

  for (const scheme of ["light", "dark"] as const) {
    for (const surface of SURFACES) {
      it(`u3704_state_rides_with_the_name_apart_from_the_actions on ${surface.seed} ${scheme}`, async () => {
        await page.scheme(scheme);
        await page.load(`/harness.html?seed=${surface.seed}`, FULLSCREEN.width, FULLSCREEN.height);
        await page.until(`() => document.body.textContent.length > 0 && Boolean(window.__fake)`);
        await page.until(`() => document.querySelector(".rail-row") !== null`);
        await new Promise((done) => setTimeout(done, 400));

        if (surface.before) await page.call(surface.before);

        // The Workstreams collapsed and expanded: the seeds start expanded, so a second pass folds each.
        const passes = [false, true];
        const fails: string[] = [];
        const seen: Record<string, number> = {};

        for (const folded of passes) {
          if (folded) await page.call(`() => { for (const own of document.querySelectorAll('.rail-row .rail-chevron')) if (own.closest('.rail-row').querySelector('svg')) own.click(); }`);
          await new Promise((done) => setTimeout(done, 700));

          const all = await page.call<{ index: number; label: string }[]>(FIND);

          for (const need of surface.rows ?? []) if (!all.some((own) => own.label.includes(need))) fails.push(`${surface.seed} ${scheme}${folded ? " folded" : ""}: no ${need} holds a state`);

          if (all.length === 0) fails.push(`${surface.seed} ${scheme}${folded ? " folded" : ""}: no state carries data-state`);

          // Selecting a row folds the Bubbles (U2224), so each kind of row is measured on a fresh opening of them.
          for (const kind of new Set(all.map((own) => own.label.split(" ")[0]!))) {
            if (surface.again && kind !== "rail-row") await page.call(surface.again);

            const rows = (await page.call<{ index: number; label: string }[]>(FIND)).filter((own) => own.label.startsWith(kind) || own.index < 0);

            for (const own of rows) {
              if (own.index < 0) {
                fails.push(`${surface.seed} ${scheme}: ${own.label}`);
                continue;
              }

              const where = `${surface.seed} ${scheme}${folded ? " folded" : ""} [${own.label}]`;
              seen[where] = 1;

              const aim = await page.call<{ x: number; y: number }>(AIM, own.index);

              await page.hover(2, 2);
              const rest = await page.call<Read>(READ, own.index);

              await page.hover(aim.x, aim.y);
              const hover = await page.call<Read>(READ, own.index);

              await page.hover(2, 2);
              await page.call(FOCUS, own.index);
              const focus = await page.call<Read>(READ, own.index);
              await page.call(`() => document.activeElement?.blur()`);

              fails.push(...judge(where, rest, rest, "rest"), ...judge(where, rest, hover, "hover"), ...judge(where, rest, focus, "focus"));
            }
          }
        }

        if (ART) {
          mkdirSync(ART, { recursive: true });
          writeFileSync(resolve(ART, `${surface.seed}-${scheme}.json`), `${JSON.stringify({ rows: Object.keys(seen), fails }, null, 2)}\n`);
        }

        // A failure that holds in every state reads once, with the states it holds in.
        const byMessage = new Map<string, string[]>();

        for (const fail of fails) {
          const [, where, mode, rest] = /^(.*?) (rest|hover|focus)( state.*|:.*)$/.exec(fail) ?? [];
          const key = where === undefined ? fail : `${where}${rest}`;

          byMessage.set(key, [...(byMessage.get(key) ?? []), mode ?? ""]);
        }

        expect([...byMessage].map(([key, modes]) => `${key} (${modes.join(", ")})`).slice(0, 80)).toEqual([]);
      });
    }
  }
});
