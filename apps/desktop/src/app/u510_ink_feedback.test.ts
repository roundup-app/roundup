import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromePath, openPage, FULLSCREEN } from "../testing/chromePage";
import type { ChromePage } from "../testing/chromePage";

/** U510 in a real Chromium: ghost, icon and disclosure buttons answer with ink only. */

const found = chromePath();

const run = found || process.env["CI"] ? describe : describe.skip;

let page: ChromePage;

beforeAll(async () => {
  if (!found) throw new Error("U510 needs a Chrome binary: set CHROME_PATH");

  page = await openPage(found);
}, 90_000);

afterAll(async () => {
  await page?.close();
});

const COVERED = `[data-button="quiet"], [data-button="add"], [data-button="row-action"], [data-button="icon"]`;

/** One enabled, visible, unselected covered button per caller: its kind, classes and label stem. */
const INVENTORY = `() => {
  const seen = new Map();

  for (const el of document.querySelectorAll('${COVERED}')) {
    const box = el.getBoundingClientRect();

    if (box.width === 0 || box.height === 0 || box.left < 0 || box.right > innerWidth || !el.checkVisibility({ opacityProperty: true, visibilityProperty: true }) || el.getAttribute('aria-disabled') === 'true' || el.disabled) continue;
    if (el.closest('[role="tab"]') || el.matches('.tab-name-button, .todo-project-root, [role="tab"]')) continue;

    const key = [el.dataset.button, el.className, (el.getAttribute('aria-label') ?? '').replace(/[0-9#].*$/, ''), el.closest('[data-selected="true"]') ? 'selected' : ''].join('|');

    // Up to three instances per caller: a row's counts yield while the pointer is near the row, so a later row may be the one that can be reached.
    for (let n = 0; n < 3; n++) if (!seen.has(key + '#' + n)) { seen.set(key + '#' + n, el); break; }
  }

  window.__covered = [...seen.values()];

  return [...seen.keys()];
}`;

/** The look of covered button \`index\`: ink, every layer that could draw a box, and its geometry. */
const LOOK = `index => {
  const el = window.__covered[index];
  const style = getComputedStyle(el);
  const probe = (token) => { const i = document.createElement('i'); i.style.color = 'var(--' + token + ')'; el.append(i); const c = getComputedStyle(i).color; i.remove(); return c; };
  const layer = (pseudo) => { const s = getComputedStyle(el, pseudo); return [s.backgroundColor, s.backgroundImage, s.boxShadow].join('|'); };
  const box = el.getBoundingClientRect();

  return {
    ink: style.color,
    grey: probe('grey'),
    text: probe('text'),
    selectedRest: probe('ink-rest-selected'),
    surface: [style.backgroundColor, style.backgroundImage, style.boxShadow, style.borderTopWidth, style.borderTopStyle, style.outlineStyle].join('|'),
    layers: layer('::before') + '/' + layer('::after'),
    ring: [style.outlineStyle, style.outlineWidth].join('|'),
    padding: [style.paddingLeft, style.paddingRight].join('|'),
    radius: style.borderTopLeftRadius,
    geometry: [box.left, box.top, box.width, box.height].join('|'),
    height: box.height,
    width: box.width,
    disclosure: el.hasAttribute('aria-expanded') && el.textContent.trim().length > 0,
    centre: [box.left + box.width / 2, box.top + box.height / 2],
    transition: style.transitionDuration,
    connected: el.isConnected,
  };
}`;

type Look = {
  ink: string;
  grey: string;
  text: string;
  selectedRest: string;
  surface: string;
  layers: string;
  ring: string;
  padding: string;
  radius: string;
  geometry: string;
  height: number;
  width: number;
  disclosure: boolean;
  centre: [number, number];
  transition: string;
  connected: boolean;
};

const SEEDS = ["tree-40", "door-report", "tabs-8", "door-stopped"];

const open = async (seed: string, scheme: "light" | "dark", contrast?: "more") => {
  await page.scheme(scheme, contrast);
  await page.load(`/harness.html?seed=${seed}`, 1280, 800);
  await page.call<void>(`() => { localStorage.clear(); sessionStorage.clear(); }`);
  await page.load(`/harness.html?seed=${seed}`, 1280, 800);
  await page.until(`() => Boolean(window.__fake)`);
  await page.until(`() => document.querySelector('${COVERED}') !== null`);
};

const COLUMNS: [string, "light" | "dark", "more" | undefined][] = [
  ["light", "light", undefined],
  ["dark", "dark", undefined],
  ["increased_contrast", "light", "more"],
];

/** Resolves when covered button \`index\` has held one position across two frames. */
const settle = (index: number) => page.until(`() => { const el = window.__covered[${index}]; const b = el.getBoundingClientRect(); const at = b.left + ':' + b.top; const same = el.__seen === at; el.__seen = at; return same; }`);

/** Visits every distinct covered caller on the seed's initial screen, hovered, pressed and focused, handing each look to \`check\`. */
const eachCaller = async (check: (name: string, looks: { rest: Look; hover: Look; pressed: Look }) => void | Promise<void>) => {
  // The screen may still be rendering: take the inventory once two reads agree, so no caller is a detached node.
  await page.until(`() => { const now = (${INVENTORY})().join(); const same = window.__names === now; window.__names = now; return same; }`);
  const names = await page.call<string[]>(INVENTORY);

  expect(names.length).toBeGreaterThan(0);

  const reached = new Set<string>();

  for (const [index, name] of names.entries()) {
    await page.hover(0, 0);
    const scrolled = await page.call<boolean>(`i => { const el = window.__covered[i]; el.scrollIntoView({ block: 'center' }); const b = el.getBoundingClientRect(); return b.width > 0 && b.top >= 0 && b.bottom <= innerHeight && b.left >= 0 && b.right <= innerWidth; }`, index);

    if (!scrolled) continue;

    await settle(index);
    const rest = await page.call<Look>(LOOK, index);
    const [x, y] = rest.centre;

    // A control revealed by its row takes no pointer until the row is hovered, as a person would reach it.
    const row = await page.call<[number, number] | null>(`i => { const el = window.__covered[i]; const b = el.getBoundingClientRect(); if (el.contains(document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2))) return null; const r = el.closest('.rail-row, .shelf-row, [data-id]')?.getBoundingClientRect(); return r ? [r.left + 4, r.top + r.height / 2] : null; }`, index);

    if (row) await page.hover(...row);

    // Hovering a strip can reflow it, so land on the control, wait for it to stop, and land again on where it settled.
    await page.hover(x, y);
    await settle(index);
    const first = await page.call<Look>(LOOK, index);

    // A control that leaves the layout while hovered (U397's row counts) is not pointer-reachable on this row; another instance stands for the caller.
    if (first.width === 0) continue;

    const [hx, hy] = first.centre;

    await page.hover(hx, hy);
    const hover = await page.call<Look>(LOOK, index);

    await page.down(hx, hy);
    const pressed = await page.call<Look>(LOOK, index);

    // Let go away from the control: the press is cancelled, so no caller's action changes the screen the next one is read on.
    await page.release(0, 0);
    await page.hover(0, 0);

    reached.add(name.replace(/#\d$/, ''));

    await check(name + (rest.connected && hover.connected && pressed.connected ? '' : ' (detached)') + ` at ${rest.geometry}`, { rest, hover, pressed });
  }

  const callers = new Set(names.map((name) => name.replace(/#\d$/, '')));

  // The row's pads count leaves the layout the moment the pointer is near its row (`display: none`, rail/styles.css, U397), so no pointer reaches it.
  const yields = (caller: string) => caller.includes('rail-pads-control');

  expect([...callers].filter((caller) => !reached.has(caller) && !yields(caller)).join(' ; '), 'callers with no instance the pointer can reach').toBe('');
};

run("u510 ghost, icon and disclosure buttons use ink feedback without hover boxes", () => {
  for (const [label, scheme, contrast] of COLUMNS)
    for (const seed of SEEDS) {
      it(`u510_hover_changes_only_ink_${seed}_${label}`, async () => {
        await open(seed, scheme, contrast);
        await eachCaller((name, { rest, hover }) => {
          // Ink moves from the resolved grey (or the selected-wash rest ink) to the resolved text; only increased contrast, where grey is text, rests at text.
          expect(rest.grey === rest.text ? [rest.text, rest.selectedRest] : [rest.grey, rest.selectedRest], name).toContain(rest.ink);
          expect(hover.ink, `${name} hover ink`).toBe(hover.text);
          expect(hover.surface, `${name} hover paints no box`).toBe(rest.surface);
          expect(hover.layers, `${name} hover paints no pseudo-element box`).toBe(rest.layers);
        });
      }, 120_000);

      it(`u510_press_dims_only_ink_${seed}_${label}`, async () => {
        await open(seed, scheme, contrast);
        await eachCaller((name, { rest, hover, pressed }) => {
          expect(pressed.ink, `${name} pressed ink`).not.toBe(hover.ink);
          expect(pressed.surface, `${name} press paints no fill`).toBe(rest.surface);
          expect(pressed.layers, `${name} press paints no pseudo-element box`).toBe(rest.layers);
          expect(pressed.ring, `${name} press does not draw a ring`).toBe(rest.ring);
          expect(pressed.transition, name).toBe("0s");
        });
      }, 120_000);

      it(`u510_disclosure_has_no_tile_geometry_${seed}_${label}`, async () => {
        await open(seed, scheme, contrast);
        await eachCaller((name, { rest, hover, pressed }) => {
          expect(hover.geometry, `${name} hover geometry`).toBe(rest.geometry);
          expect(pressed.geometry, `${name} pressed geometry`).toBe(rest.geometry);
          expect(rest.radius, `${name} radius`).toBe("0px");
          expect(rest.height, `${name} minimum target height`).toBeGreaterThanOrEqual(24);

          if (rest.disclosure) expect(rest.padding, `${name} inline padding`).toBe("0px|0px");
        });
      }, 120_000);
    }

  it("u510_targets_remain_reachable", async () => {
    await open("tree-40", "light");
    const names = await page.call<string[]>(INVENTORY);

    const overlaps = await page.call<string[]>(`() => {
      const boxes = window.__covered.map(el => [el, el.getBoundingClientRect()]);
      const bad = [];

      for (const [a, ra] of boxes)
        for (const [b, rb] of boxes)
          if (a !== b && a.parentElement === b.parentElement && ra.left < rb.right - 0.5 && rb.left < ra.right - 0.5 && ra.top < rb.bottom - 0.5 && rb.top < ra.bottom - 0.5) bad.push((a.getAttribute('aria-label') ?? a.className) + ' / ' + (b.getAttribute('aria-label') ?? b.className));

      return bad;
    }`);

    expect(names.length).toBeGreaterThan(0);
    expect(overlaps).toEqual([]);

    // The icon button keeps its 24 px square target around a 16 px mark.
    const icon = await page.call<[number, number, number] | null>(`() => { const el = document.querySelector('[data-button="icon"]:not([aria-pressed])'); if (!el) return null; const b = el.getBoundingClientRect(); const svg = el.querySelector('svg'); return [b.width, b.height, svg ? svg.getBoundingClientRect().width : 16]; }`);

    if (icon) expect(icon).toEqual([24, 24, 16]);
  }, 60_000);

  it("u510_focus_ring_is_keyboard_only", async () => {
    await open("tree-40", "light");
    const names = await page.call<string[]>(INVENTORY);

    expect(names.length).toBeGreaterThan(0);

    const [x, y] = (await page.call<Look>(LOOK, 0)).centre;

    await page.click(x, y);
    await page.call<void>(`() => { document.activeElement?.blur?.(); }`);
    await page.click(x, y);
    expect(await page.call<string>(`() => getComputedStyle(document.activeElement).outlineStyle`), "pointer focus").toBe("none");

    await page.press("Tab", "Tab");
    const ring = await page.call<string[]>(`() => { const s = getComputedStyle(document.activeElement); const accent = (() => { const i = document.createElement('i'); i.style.color = 'var(--accent)'; document.body.append(i); const c = getComputedStyle(i).color; i.remove(); return c; })(); return [s.outlineStyle, s.outlineWidth, s.outlineColor, accent]; }`);

    expect(ring[0]).not.toBe("none");
    expect(ring[1]).toBe("2px");
    expect(ring[2]).toBe(ring[3]);
  }, 60_000);

  it("u510_disabled_behavior_is_preserved", async () => {
    await open("tree-40", "light");

    const result = await page.call<{ found: boolean; same: boolean; named: boolean; focusable: boolean; centre: [number, number] }>(`() => {
      const el = document.querySelector('[data-button="quiet"][aria-disabled="true"], [data-button="icon"][aria-disabled="true"]');

      if (!el) return { found: false, same: true, named: true, focusable: true, centre: [0, 0] };
      const s = getComputedStyle(el);
      const b = el.getBoundingClientRect();

      return { found: true, same: s.cursor === 'default', named: (el.getAttribute('aria-label') ?? el.textContent).trim().length > 0, focusable: el.tabIndex >= 0 && !el.hasAttribute('disabled'), centre: [b.left + b.width / 2, b.top + b.height / 2] };
    }`);

    if (!result.found) return;

    const inkOf = `() => { const el = document.querySelector('[data-button][aria-disabled="true"]'); return getComputedStyle(el).color + '|' + getComputedStyle(el).backgroundColor; }`;
    const rest = await page.call<string>(inkOf);

    await page.hover(...result.centre);
    expect(await page.call<string>(inkOf)).toBe(rest);
    await page.down(...result.centre);
    expect(await page.call<string>(inkOf)).toBe(rest);
    await page.release(...result.centre);

    expect(result.same).toBe(true);
    expect(result.named).toBe(true);
    expect(result.focusable).toBe(true);
  }, 60_000);

  // Every inventoried caller above is one of these; the sweep covers each seed, scheme and width the scenario names.
  it("u510_app_callers_have_ink_feedback", async () => {
    const callers = new Set<string>();

    for (const seed of SEEDS) {
      await open(seed, "light");

      for (const name of await page.call<string[]>(INVENTORY)) callers.add(name.replace(/#\d$/, ''));
    }

    // Raw callers (a bare `button` with no kind) and kinds outside the four covered ones keep their fill; none may sit inside the covered set by accident.
    expect(callers.size).toBeGreaterThan(8);
    expect([...callers].filter((caller) => !/^(quiet|add|row-action|icon)\|/.test(caller))).toEqual([]);
  }, 120_000);

  for (const [label, scheme, contrast] of COLUMNS)
    for (const width of [FULLSCREEN.width])
      it(`u510_rendered_checks_${label}_${width}`, async () => {
        await page.scheme(scheme, contrast);
        await page.load("/harness.html?seed=tree-40", width, FULLSCREEN.height);
        await page.until(`() => Boolean(window.__fake) && document.querySelector('${COVERED}') !== null`);
        await page.until(`() => { const now = document.querySelectorAll('button').length; const same = window.__buttons === now; window.__buttons = now; return same; }`);

        const checks = await page.call<Record<string, { status: string; value: unknown; selector: string }>>(`() => import('/src/testing/checks.ts').then(m => m.runChecks())`);

        for (const id of ["D2", "D5", "D6", "D7"]) expect(checks[id], `${id} ${JSON.stringify(checks[id])}`).toMatchObject({ status: "pass" });
      }, 60_000);
});
