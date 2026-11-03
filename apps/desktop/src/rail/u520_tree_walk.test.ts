import { createRoot } from "solid-js";
import { connectProject } from "../state/connectedProject";
import { createFakeApp } from "../testing/fakeApp";
import { agent, workstream, NOW } from "../testing/nodes";
import * as topology from "./topology";
import { createRailTree } from "./railTree";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { captureDir } from "../testing/captures";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { chromePath, openPage } from "../testing/chromePage";
import type { ChromePage } from "../testing/chromePage";

/** U520: the Rail's keyboard walk is the real Ark TreeView's in headless Chromium; `tree-40` is Workstream → Workstream → Agent with a sibling after the first. */

const found = chromePath();

const run = found || process.env["CI"] ? describe : describe.skip;

let page: ChromePage;

// CI 41644930161 spent 34,282 ms here; only the first walk uses the Shelf.
// Captures retain the complete frame for the design observer.
const walkHarness = `/harness.html?view=workstreams&seed=tree-40${process.env["ROUNDUP_CAPTURES"] ? "&items=1&tabs=1" : ""}`;

const focused = (): Promise<string | null> =>
  page.call<string | null>(`() => document.activeElement?.closest('[data-id]')?.getAttribute('data-id') ?? null`);

const expanded = (id: string): Promise<string | null> =>
  page.call<string | null>(`(id) => document.querySelector('[role=treeitem][data-id="' + id + '"]')?.getAttribute('aria-expanded') ?? null`, id);

const at = async (id: string): Promise<void> => {
  await page.until(`() => document.activeElement?.closest('[data-id]')?.getAttribute('data-id') === ${JSON.stringify(id)}`);
  expect(await focused()).toBe(id);
};

const folded = async (id: string, value: "true" | "false"): Promise<void> => {
  await page.until(`() => document.querySelector('[role=treeitem][data-id="${id}"]')?.getAttribute('aria-expanded') === '${value}'`);
  expect(await expanded(id)).toBe(value);
};


const capture = async (step: string) => {
  for (const id of ["U5483a", "U5483b", "U5483c", "U5645a", "U5645b", "U5645c"]) {
    const target = captureDir(id);
    const dir = target && (id.startsWith("U5645") ? join(target, process.env["ROUNDUP_CAPTURE_PHASE"] ?? "head") : target);

    if (!dir) continue;
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${step}.png`), Buffer.from(await page.shot(), "base64"));
    writeFileSync(join(dir, `${step}.checks.json`), JSON.stringify(await page.call(`() => window.__checks()`), null, 2));
  }
};

const CODES = { ArrowDown: "ArrowDown", ArrowUp: "ArrowUp", ArrowLeft: "ArrowLeft", ArrowRight: "ArrowRight", Home: "Home", End: "End", m: "KeyM" } as const;

const press = (key: keyof typeof CODES): Promise<void> => page.press(key, CODES[key]);

// Both walks reload the harness per test; one isolated browser/server serves the file.
afterAll(async () => { await page?.close(); });

run("u520 the Rail is a tree", () => {
  beforeAll(async () => {
    if (!found) throw new Error("U520 needs a Chrome binary: set CHROME_PATH");

    page = await openPage(found);
  }, 90_000);

  vi.setConfig({ testTimeout: 60_000 });

  it("u520_three_level_keyboard_walk", async () => {
    await page.load("/harness.html?view=workstreams&items=1&tabs=1&seed=tree-40", 1280, 800);
    await page.until(`() => document.querySelector('[role=tree] [data-id="backend"]') !== null`);

    // Close the Shelf so its bar-to-panel Tab path does not precede the Rail.
    await page.call(`() => document.querySelector('#shelf-tab-todos').click()`);
    await page.until(`() => document.querySelector('.shelf')?.hidden === true`);

    // U4547a adds heading Tab stops; enter the first data row after its heading.
    for (let tabs = 0; tabs < 12 && !(await page.call<boolean>(`() => document.activeElement?.matches('[role=tree] [data-part=item], [role=tree] [data-part=branch-control]:not(.section-head)') === true`)); tabs += 1) await page.press("Tab", "Tab");

    await at("backend");
    await press("ArrowDown");
    await at("auth");
    await press("ArrowDown");
    await at("tokens");
    // Left on a leaf moves to its parent, which stays open.
    await press("ArrowLeft");
    await at("auth");
    await folded("auth", "true");
    // Left on an open branch folds it, then moves to its parent.
    await press("ArrowLeft");
    await folded("auth", "false");
    await at("auth");
    await press("ArrowLeft");
    await at("backend");
    // Right on an open branch moves to its first child; on a folded branch opens it, then enters it.
    await press("ArrowRight");
    await at("auth");
    await press("ArrowRight");
    await folded("auth", "true");
    await press("ArrowRight");
    await at("tokens");
    await press("Home");
    await page.until(`() => document.activeElement?.matches('.section-head') === true`);
    expect(await page.call<boolean>(`() => document.activeElement === document.querySelector('.rail-tree .section-head')`)).toBe(true);
    await press("End");
    expect(await page.call<boolean>(`() => { const rows = [...document.querySelectorAll('[role=tree] [data-part=item], [role=tree] [data-part=branch-control]')].filter((row) => row.checkVisibility()); return rows.at(-1) === document.activeElement; }`)).toBe(true);
    await press("Home");
    await page.until(`() => document.activeElement?.matches('.section-head') === true`);
    expect(await page.call<boolean>(`() => document.activeElement === document.querySelector('.rail-tree .section-head')`)).toBe(true);
    // A letter jumps to the row whose name begins with it.
    await press("m");
    await at("migrate");
  });

  it("u520_done_line_is_not_a_row", async () => {
    await page.load(walkHarness, 1280, 800);
    await page.until(`() => document.querySelector('[role=tree] [data-id="auth"]') !== null`);

    const rows = await page.call<string[]>(`() => [...document.querySelectorAll('[role=treeitem][data-id]')].map((row) => row.getAttribute('data-id'))`);

    // The idle branch is a row; its hidden children are absent from the walk.
    expect(await page.call<number>(`() => document.querySelectorAll('.rail-fold').length`)).toBeGreaterThan(0);
    expect(rows).not.toContain("docs");
    expect(rows).toContain("fold:auth");
  });
});


run("u5483 folded children", () => {
  beforeAll(async () => {
    if (found && !page) page = await openPage(found);
    // Group isolation requires clearing saved Shelf/fold choices before the next fresh tab.
    else if (page) await page.call("() => { localStorage.clear(); sessionStorage.clear(); }");
  }, 90_000);
  it("u5483b_keyboard_walk_enters_only_open_children", async () => {
    await page.scheme("dark");
    await page.load(walkHarness, 1512, 950);
    await page.until(`() => !!document.querySelector('[data-id="fold:auth"]')`);
    await page.call(`() => document.querySelector('[data-id="fold:auth"] [data-part="branch-control"]').focus()`);
    await press("ArrowRight");
    await folded("fold:auth", "true");
    await press("ArrowRight");
    await at("docs");

    await capture("open");
    await press("ArrowLeft");
    await at("fold:auth");
    await press("ArrowLeft");
    await folded("fold:auth", "false");
    expect(await page.call<boolean>(`() => document.querySelector('[data-id="docs"]') === null`)).toBe(true);
    await capture("closed");
  });
  it("u5483b_keyboard_walk_reaches_a_folded_agents_descendant", async () => {
    await page.scheme("dark");
    await page.load(walkHarness, 1512, 950);
    await page.until(`() => !!document.querySelector('[data-id="fold:auth"]')`);
    await page.call(`async () => {
      const nodes = await window.__fake.app.rpc('rail.tree', null);
      const parent = nodes.find(node => node.id === 'docs');
      const descendant = { ...parent, id: 'fold-descendant', name: 'fold descendant', parent: 'docs', final_text: undefined,
        status: { kind: 'working', label: 'working', since: Date.now(), finished: '0' } };
      window.__fake.app.handlers['rail.tree'] = () => [...nodes, descendant];
      window.__fake.emit({ actor: { kind: 'user', id: 'you', parent: null }, name: 'rail.changed' });
    }`);
    await page.call(`() => document.querySelector('[data-id="fold:auth"] [data-part="branch-control"]').focus()`);
    await press("ArrowRight");
    await folded("fold:auth", "true");
    await press("ArrowRight");
    await at("docs");
    await press("ArrowRight");
    await at("fold-descendant");
    await capture("descendant");
  });

  it("u5483b_focus_survives_folding_and_return", async () => {
    await page.load(walkHarness, 1512, 950);
    await page.until(`() => !!document.querySelector('[data-id="fold:auth"]')`);
    await page.call(`() => document.querySelector('[data-id="fold:auth"] [data-part="branch-control"]').focus()`);
    await press("ArrowRight");
    await folded("fold:auth", "true");
    await press("ArrowRight");
    await at("docs");
    await page.call(`() => window.__fake.setStatus('docs', 'working', 'working')`);
    await at("docs");
    await page.call(`() => window.__fake.setStatus('docs', 'done', 'finished')`);
    await page.until(`() => !!document.querySelector('[data-id="fold:auth"]')`);
    await at("docs");
    await press("ArrowLeft");
    await at("fold:auth");
    await press("ArrowLeft");
    await folded("fold:auth", "false");
    await page.call(`() => window.__fake.setStatus('docs', 'working', 'working')`);
    await at("auth");
    await page.call(`() => document.querySelector('[data-id="docs"]').focus()`);
    await at("docs");
    await page.call(`() => window.__fake.setStatus('docs', 'done', 'finished')`);
    await at("fold:auth");
  });

});

// Exercise the same owner/projection Rail mounts; getters charge only its source reads.
it("u5645a_one_topology_serves_rows_and_collection_at_40_and_400", async () => {
  const construction = vi.spyOn(topology, "railTopology");

  for (const size of [40, 400]) {
    construction.mockClear();

    const chain = Array.from({ length: size - 4 }, (_, at) => workstream(`chain-${at}`, {
      parent: at === 0 ? null : `chain-${at - 1}`, order: at,
    }));

    const expected = [...chain.map(node => node.id), "earlier", "later", "mode", "root-agent"];

    const source = [...chain.toReversed(), workstream("later", { order: 8 }),
      agent("root-agent", "working", "x"), workstream("mode", { opening_prompt: "Go" }), workstream("earlier", { order: 7 })];

    let parents = 0;

    const counted = source.map(node => ({ ...node, get parent() { parents += 1;

 return node.parent; } }));

    const app = createFakeApp();
    app.handlers["rail.tree"] = () => counted;
    const connected = await connectProject(app, { path: "/p", name: "p" }, () => true, () => NOW);
    createRoot(dispose => {
      const tree = createRailTree(connected, () => new Set(), () => undefined);
      expect(tree.rows().map(row => row.key)).toEqual(expected.map(id => `node:${id}`));
      expect(tree.collection().getValues().filter(id => !id.startsWith("section:"))).toEqual(expected);
      expect(tree.sectionRows().map(section => section.id)).toEqual(["workstreams", "modes", "agents"]);
      expect(tree.topology().nodes.every(node => connected.rail.nodes.includes(node))).toBe(true);
      tree.treeRows();
      tree.expanded();
      expect(construction.mock.results.filter(result => result.type === "return" && result.value.nodes.length === size)).toHaveLength(1);
      expect(parents).toBe(size);
      dispose();
    });
  }

  construction.mockRestore();
});
