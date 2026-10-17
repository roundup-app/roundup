import { afterAll, beforeAll, expect, it } from "vitest";
import { mkdirSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { createServer } from "vite";
import type { ViteDevServer } from "vite";
import { captureDir } from "../testing/captures";

const exec = promisify(execFile);

const profile = mkdtempSync(join(tmpdir(), "u466-browser-"));

const session = `u466-${process.pid}`;

// Under controlled contention the warmed batch took 3,422 ms and read 390 ms.
// Bound commands at 4 s while retaining the observer's existing 5 s limit.
const command = async (args: string[], input?: string, limit = 4_000) => {
  const started = performance.now();
  const label = JSON.stringify(args) + (input ?? "");

  if (process.env.U508_TRACE) console.log("U508 start", label);

  const pending = exec("agent-browser", ["--session", session, "--json", ...args], {
    maxBuffer: 8 * 1024 * 1024, timeout: limit,
  });

  pending.child.stdin?.end(input);

  try {
    const reply = await pending;

    if (process.env.U508_TRACE) console.log("U508 completed", Math.round(performance.now() - started), label);

    return reply.stdout;
  } catch (error) {
    const state = error instanceof Error && "killed" in error && error.killed ? "pending" : "failed";
    const output = error instanceof Error && "stdout" in error ? String(error.stdout) : "";
    throw new Error(`${state} browser command after ${Math.round(performance.now() - started)} ms (limit ${limit} ms): ${label}: ${String(error)} ${output}`, { cause: error });
  }
};

const browser = (...args: string[]) => command(args);

let navigationGate: { requested: () => void; released: Promise<void> } | undefined;

let server: ViteDevServer;

let origin: string;

const page = {
  until: async (predicate: string) => { await browser("wait", "--fn", `(${predicate})()`); },
  call: async <T,>(declaration: string, ...args: unknown[]): Promise<T> => {
    // SAFETY: agent-browser's JSON envelope contains the result of this constant page expression.
    const reply = JSON.parse(await browser("eval", `(${declaration})(...${JSON.stringify(args)})`)) as { success: boolean; data: { result: T }; error: string | null };

    if (!reply.success) throw new Error(reply.error ?? "browser evaluation failed");

    return reply.data.result;
  },
};

const railWidths = [252, 288, 480] as const;

const art = captureDir("U466");

beforeAll(async () => {
  server = await createServer({ cacheDir: join(profile, "vite"), server: { port: 0, hmr: false }, logLevel: "silent", plugins: [{
    name: "u508-navigation-gate",
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        if (navigationGate && (request.url?.startsWith("/harness.html") || request.url === "/u508-pending")) {
          const gate = navigationGate;
          navigationGate = undefined;
          gate.requested();
          await gate.released;

          if (request.url === "/u508-pending") {
            response.end("released");

            return;
          }
        }

        next();
      });
    },
  }] });
  await server.listen();
  origin = server.resolvedUrls!.local[0]!.replace(/\/$/, "");
  // index.html loads main.tsx; the tests navigate to harness.tsx. Warm the entry
  // they actually use so cold harness transforms stay inside the startup hook.
  await command(["--profile", profile, "open", origin + "/harness.html?seed=tree-40"], undefined, 60_000);
}, 90_000);

afterAll(async () => {
  try { await browser("close"); }
  finally { await server?.close(); rmSync(profile, { recursive: true, force: true }); }
});

const load = async (seed = "tree-40", viewport = 1280, scheme: "light" | "dark" = "light", width = 288) => {
  const commands = [
    ["set", "media", scheme],
    ["set", "viewport", String(viewport), "800"],
    ["open", origin + "/harness.html?seed=" + seed],
    ["wait", "--fn", "document.querySelectorAll('.rail-row').length > 8"],
    ["eval", "document.querySelector('.rail-row[data-id]').click()"],
    ["wait", "--fn", `Boolean(document.querySelector('.rail-row[data-selected="true"]'))`],
    ["eval", `document.querySelector('.rail').style.width = ${width} + 'px'`],
  ];

  // SAFETY: agent-browser batch returns its ordered command/success/error envelopes.
  const replies = JSON.parse(await command(["batch", "--bail"], JSON.stringify(commands))) as { command: string[]; success: boolean; error: string | null }[];

  for (const reply of replies) {
    if (!reply.success) throw new Error(`browser command ${JSON.stringify(reply.command)} failed: ${reply.error}`);
  }
};

const read = () => page.call<{ padding: string[]; rows: {padding: string[];left:number;right:number;height:number;nameLeft:number;size:string}[]; heads: number[]; glyphs: number[][]; overflow:boolean; bar:string; rail:number[] }>(`() => {
  const rail=document.querySelector('.rail'), list=document.querySelector('.rail-scroll');
  const r=rail.getBoundingClientRect();
  return {padding:[getComputedStyle(list).paddingLeft,getComputedStyle(list).paddingRight],
    rows:[...document.querySelectorAll('.rail-row')].map(row=>{const b=row.getBoundingClientRect(),s=getComputedStyle(row),n=row.querySelector('.name');return {padding:[s.paddingLeft,s.paddingRight],left:b.left-r.left,right:r.right-b.right,height:b.height,nameLeft:n.getBoundingClientRect().left-r.left,size:getComputedStyle(n).fontSize};}),
    heads:[...rail.querySelectorAll('.section-head')].map(h=>h.getBoundingClientRect().left-r.left+parseFloat(getComputedStyle(h).paddingLeft)),
    glyphs:[...rail.querySelectorAll('.glyph svg')].map(g=>{const b=g.getBoundingClientRect();return [b.width,b.height]}),
    overflow:list.scrollWidth>list.clientWidth,bar:getComputedStyle(rail.querySelector('[data-selected="true"]')).backgroundSize,rail:[r.left,r.right]};
}`);

it("u466_the_list_has_zero_inline_padding", async () => {
  for (const width of railWidths) { await load("tree-40",1280,"light",width); expect((await read()).padding).toEqual(["0px","0px"]); }
}, 60_000);

it("u466_rows_and_heads_own_the_sixteen_px_inset", async () => {
  await load(); const seen=await read();
  expect(seen.rows.every(r=>r.padding.every(p=>p==="16px"))).toBe(true);
  expect(seen.heads).toEqual([16]);
});

it("u466_leading_content_columns_stay_put", async () => {
  await load(); const seen=await read();
  expect(seen.rows[0]!.nameLeft).toBe(44);
  expect(seen.heads).toEqual([16]);
});

it("u466_bands_and_the_selected_bar_reach_the_rail_edges", async () => {
  await load(); const seen=await read();
  expect(seen.rows.every(r=>r.left===0 && Math.abs(r.right-1)<=1)).toBe(true);
  expect(seen.bar.split(",")[0]).toBe("2px 100%");
});

it("u466_names_use_title_and_status_glyphs_use_space_three", async () => {
  await load(); const seen=await read();
  expect(seen.rows.every(r=>r.size==="15px")).toBe(true);
  expect(seen.glyphs.length).toBeGreaterThan(0);
  expect(seen.glyphs.every(b=>b[0]===12 && b[1]===12)).toBe(true);
});

it("u466_existing_density_assertions_read_the_row", async () => {
  await load(); const seen=await read();
  expect(seen.padding).toEqual(["0px","0px"]);
  expect(seen.rows.every(r=>r.height===32 && r.padding[0]==="16px")).toBe(true);
});

it("u466_tree_40_fits_with_row_insets_and_actions", async () => {
  for(const width of railWidths) { await load("tree-40",1280,"light",width); expect((await read()).overflow).toBe(false); }
},60_000);

it("u466_ten_agents_keep_selection_and_attention_distinct", async () => {
  await load("agents-10");
  expect(await page.call(`() => ({selected:document.querySelectorAll('.rail-row[data-selected="true"]').length,attention:[...document.querySelectorAll('.rail .glyph.ink')].map(g=>g.getAttribute('aria-label'))})`)).toEqual({selected:1,attention:expect.arrayContaining(["Error","Needs-you"])});
});

it("u466_smaller_glyphs_keep_kind_and_action_targets", async () => {
  await load("agents-10");
  await page.call("() => document.querySelector('.rail-fold button').click()");
  await page.until("() => Boolean(document.querySelector('.rail .glyph[aria-label=\"Done\"]'))");
  await browser("hover", '.rail-row[data-id="agent-1"]');

  const seen = await page.call<{kinds:string[];targets:number[][];viewBoxes:string[]}>(`() => ({
    kinds:[...document.querySelectorAll('.rail .glyph')].map(g=>g.getAttribute('aria-label')).filter(Boolean),
    targets:[...document.querySelectorAll('.rail-row[data-near="true"] .row-icons button')].map(b=>{const r=b.getBoundingClientRect();return [r.width,r.height]}),
    viewBoxes:[...document.querySelectorAll('.rail .glyph svg')].map(s=>s.getAttribute('viewBox'))
  })`);

  expect(new Set(seen.kinds)).toEqual(new Set(["Error","Needs-you","Blocked","Working","Idle","Done"]));
  expect(seen.targets.length).toBeGreaterThan(0);
  expect(seen.targets.every(b=>b[0]!>=24 && b[1]!>=24)).toBe(true);
  expect(seen.viewBoxes.every(v=>v==="0 0 16 16")).toBe(true);
},60_000);

it("u466_smaller_glyphs_keep_trunks_and_elbows_aligned", async () => {
  await load();

  const offsets=await page.call<number[]>(`() => {
    const stack=[], offsets=[];
    for(const row of document.querySelectorAll('.rail-row[data-id]')) {
      const depth=Number(row.closest('[role=treeitem]').getAttribute('aria-level'))-1;
      const mark=row.querySelector('.line > .rail-chevron .icon')??row.querySelector('.line > .glyph');
      const b=mark.getBoundingClientRect(); stack.length=depth;
      if(depth>0) {
        const parent=stack[depth-1].getBoundingClientRect(), branch=row.querySelector(':scope > .rail-branch').getBoundingClientRect();
        offsets.push(Math.abs(branch.left-(parent.left+parent.right)/2),Math.abs(branch.right-b.left));
      }
      stack[depth]=mark;
    }
    return offsets;
  }`);

  expect(offsets.length).toBeGreaterThan(0);
  expect(offsets.every(n=>n<=1)).toBe(true);
});

it("u466_owned_names_and_done_lines_keep_the_content_inset", async () => {
  await load();
  await page.call(`() => document.querySelector('.rail-row[data-id="tokens"] [data-pads-control]').click()`);
  await page.until("() => document.querySelectorAll('.rail-leaf').length > 0");

  const seen=await page.call<{insets:string[][];sizes:string[]}>(`() => ({
    insets:[...document.querySelectorAll('.rail-leaf,.rail-fold')].map(r=>{const s=getComputedStyle(r);return [s.paddingLeft,s.paddingRight]}),
    sizes:[...document.querySelectorAll('.rail-pad > span,.rail-leaf .shelf-title')].map(n=>getComputedStyle(n).fontSize)
  })`);

  expect(seen.insets.length).toBeGreaterThan(0);
  expect(seen.insets.every(p=>p[0]==="16px" && p[1]==="16px")).toBe(true);
  expect(seen.sizes.length).toBeGreaterThan(0);
  expect(seen.sizes.every(s=>s==="15px")).toBe(true);
});

it("u466_failure_text_stays_visible_on_the_densest_seed", async () => {
  await load();
  await page.call(`() => {window.__fake.app.editorFailure=new Error('no code editor found');document.querySelector('.rail-row [aria-label="Open in editor"]').click();}`);
  await page.until("() => document.querySelector('.rail > .ink')?.textContent.includes('no code editor found')");
  expect(await page.call(`() => {const e=document.querySelector('.rail > .ink'),b=e.getBoundingClientRect();return b.width>0 && b.height>0 && b.bottom<=innerHeight;}`)).toBe(true);

  if(art) {
    await browser("screenshot",join(art,"failure.png"));
    writeFileSync(join(art,"failure.checks.json"),JSON.stringify(await page.call("() => window.__checks()")));
  }
},60_000);

it("u466_nested_selected_states_keep_the_bar_and_geometry", async () => {
  await load();

  const ids = await page.call<string[]>(`() => {
    const depths = new Set();
    return [...document.querySelectorAll('.rail-row[data-id]')].filter(r=> {
      const level=r.closest('[role=treeitem]').getAttribute('aria-level');
      if(depths.has(level)) return false; depths.add(level); return true;
    }).map(r=>r.dataset.id);
  }`);

  expect(ids.length).toBeGreaterThan(1);

  for (const id of ids) {
    const selector = `.rail-row[data-id="${id}"]`;
    await page.call("(id) => document.querySelector('.rail-row[data-id=\"'+id+'\"]').click()",id);
    await page.until(`() => document.querySelector('${selector}').dataset.selected==='true'`);

    const geometry = `() => {
      const row=document.querySelector('${selector}'), b=row.getBoundingClientRect(), n=row.querySelector('.name').getBoundingClientRect(),rail=document.querySelector('.rail').getBoundingClientRect(),s=getComputedStyle(row);
      return {box:[b.top,b.height,n.left],edges:[b.left-rail.left,rail.right-b.right],bar:s.backgroundSize.split(',')[0],position:s.backgroundPosition};
    }`;

    const before = await page.call<{box:number[];edges:number[];bar:string;position:string}>(geometry);
    await browser("hover",selector+" .name");
    await page.until(`() => document.querySelector('${selector}').matches(':hover')`);
    const hovered = await page.call<typeof before>(geometry);
    expect(hovered.box).toEqual(before.box);
    expect(hovered.edges.every(n=>Math.abs(n)<=1)).toBe(true);
    expect(hovered.bar).toBe("2px 100%");
    const point = await page.call<{x:number;y:number}>(`() => {const b=document.querySelector('${selector}').getBoundingClientRect();return {x:b.left+4,y:b.top+b.height/2};}`);
    await browser("mouse","move",String(point.x),String(point.y));
    await browser("mouse","down","left");
    await page.until(`() => document.querySelector('${selector}').matches(':active')`);
    const pressed = await page.call<typeof before>(geometry);
    await browser("mouse","up","left");
    expect(pressed.box).toEqual(before.box);
    expect(pressed.bar).toBe("2px 100%");
    expect(pressed.position).toMatch(/^0(?:px|%) 0(?:px|%)/);

    if(art) {
      await browser("screenshot",join(art,"selected-"+id+".png"));
      writeFileSync(join(art,"selected-"+id+".checks.json"),JSON.stringify(await page.call("() => window.__checks()")));
    }
  }
},90_000);

it("u466_editing_keeps_the_title_size_and_name_column", async () => {
  await load();
  const left = await page.call<number>("() => document.querySelector('.rail-row .name').getBoundingClientRect().left");
  await browser("dblclick",".rail-row .name");
  await page.until("() => Boolean(document.querySelector('.rail-row input'))");
  const field = await page.call<{size:string;left:number}>("() => {const e=document.querySelector('.rail-row input');return {size:getComputedStyle(e).fontSize,left:e.getBoundingClientRect().left};}");
  expect(field.size).toBe("15px");
  expect(field.left).toBeCloseTo(left,0);
},60_000);

it("u508_completed_commands_preserve_load_order", async () => {
  let requested!: () => void;
  let release!: () => void;
  const arrived = new Promise<void>(resolve => { requested = resolve; });
  const released = new Promise<void>(resolve => { release = resolve; });
  navigationGate = { requested, released };
  let completed = false;
  const loading = load("tree-40", 1280, "light", 480).then(() => { completed = true; });

  try {
    await arrived;
    expect(completed).toBe(false);
  } finally { release(); }

  await loading;
  expect(await page.call(`() => ({ selected: document.querySelectorAll('.rail-row[data-selected="true"]').length, width: document.querySelector('.rail').getBoundingClientRect().width })`)).toEqual({ selected: 1, width: 480 });
});

// The error, pending evaluation and drain each have a 4 s command bound.
it("u508_pending_or_failed_command_is_identified", async () => {
  await expect(command(["eval", "throw new Error(['u508', 'failed'].join(' '))"])).rejects.toThrow(/eval.*"error":".*u508 failed/s);
  const started = performance.now();
  let release!: () => void;
  let requested!: () => void;
  const arrived = new Promise<void>(resolve => { requested = resolve; });
  const released = new Promise<void>(resolve => { release = resolve; });
  navigationGate = { requested, released };
  const result = expect(command(["eval", "fetch('/u508-pending')"])).rejects.toThrow(/pending.*eval.*u508-pending/s);

  try {
    await arrived;
    await result;
    expect(performance.now() - started).toBeLessThan(4_500);
  } finally { release(); }

  // Drain the released evaluation before cleanup uses this session.
  await page.call("() => true");
}, 13_000);
