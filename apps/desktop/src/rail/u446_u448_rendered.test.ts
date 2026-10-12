import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "vite";
import type { ViteDevServer } from "vite";
import { afterAll, beforeAll, expect, it } from "vitest";

const exec = promisify(execFile);

const profile = mkdtempSync(join(tmpdir(), "rail-browser-"));

const session = `rail-${process.pid}`;

const art = resolve("../../artifacts/ux/U446");

const railArt = resolve("../../artifacts/ux/U448");

let server: ViteDevServer;

let origin: string;

const browser = async (...args: string[]) => (await exec("agent-browser", ["--session", session, "--json", ...args], { maxBuffer: 8 * 1024 * 1024 })).stdout;

const read = async <T,>(expression: string): Promise<T> => {
  // SAFETY: agent-browser's JSON envelope carries the result of the constant page expression below.
  const reply = JSON.parse(await browser("eval", expression)) as { success: boolean; data: { result: T }; error: string | null };

  if (!reply.success) throw new Error(reply.error ?? "browser evaluation failed");

  return reply.data.result;
};

const load = async (seed = "tree-40", width = 1280, scheme = "light") => {
  await browser("set", "media", scheme);
  await browser("set", "viewport", String(width), "800");
  await browser("open", `${origin}/harness.html?seed=${seed}`);
  await browser("wait", "--fn", "Boolean(window.__fake) && document.querySelectorAll('.rail-row').length > 2");
};

beforeAll(async () => {
  server = await createServer({ cacheDir: join(profile, "vite"), server: { port: 0, hmr: false }, logLevel: "silent" });
  await server.listen();
  origin = server.resolvedUrls!.local[0]!;
  await browser("--profile", profile, "open", origin);
  mkdirSync(art, { recursive: true });
  mkdirSync(railArt, { recursive: true });
}, 90_000);

afterAll(async () => {
  try {
    await browser("close");
  } finally {
    await server?.close();
    rmSync(profile, { recursive: true, force: true });
  }
});

it("u446_only_working_turns", async () => {
  await load();
  const kinds = await read<string[]>(`[...document.querySelectorAll('.glyph')].filter(g => g.getAnimations({subtree:true}).length).map(g => g.dataset.drawing)`);
  expect(kinds.length).toBeGreaterThan(0);
  expect(new Set(kinds)).toEqual(new Set(["quarter"]));

  const timing = await read<{ duration: number; easing: string; properties: string[] }>(`(() => {
    const a = document.querySelector('.working-arc').getAnimations()[0];
    return { duration: a.effect.getTiming().duration, easing: a.effect.getTiming().easing,
      properties: Object.keys(a.effect.getKeyframes()[1]).filter(k => !['offset','computedOffset','easing','composite'].includes(k)) };
  })()`);

  expect(timing.duration).toBeGreaterThanOrEqual(900);
  expect(timing.duration).toBeLessThanOrEqual(1100);
  expect(timing.easing).toBe("linear");
  expect(timing.properties).toEqual(["transform"]);
}, 60_000);

it("u446_reduced_motion_stills_the_arc", async () => {
  await load();
  await browser("set", "media", "light", "reduced-motion");
  expect(await read<number>(`document.querySelector('.working-arc').getAnimations().length`)).toBe(0);
  expect(await read<string>(`getComputedStyle(document.querySelector('.working-arc')).transform`)).toBe("none");
}, 60_000);

it("u446_ten_working_agents_move_no_box", async () => {
  await load("agents-10");
  await read(`(() => { for(let n=1;n<=10;n++) window.__fake.setStatus('agent-'+n, 'working', 'working'); })()`);
  await browser("wait", "--fn", "document.querySelectorAll('.working-arc').length === 10");

  const frames = await read<number[][]>(`(async () => {
    const boxes = () => [...document.querySelectorAll('.rail-row,.glyph')].flatMap(r => { const b=r.getBoundingClientRect(); return [b.x,b.y,b.width,b.height]; });
    const out = [boxes()];
    for(let i=0;i<3;i++) { await new Promise(requestAnimationFrame); out.push(boxes()); }
    return out;
  })()`);

  for (const frame of frames) expect(frame).toEqual(frames[0]);
  writeFileSync(join(art, "ten-working-frames.json"), JSON.stringify(frames));

  const columns = await read<number[][]>(`(() => {
    const groups=new Map();
    for(const row of document.querySelectorAll('.rail-row')) {
      const x=row.querySelector('.line > .glyph')?.getBoundingClientRect().left;
      if(x===undefined) continue;
      const level=row.getAttribute('aria-level');
      groups.set(level,[...(groups.get(level)??[]),x]);
    }
    return [...groups.values()];
  })()`);

  for(const column of columns) expect(Math.max(...column)-Math.min(...column)).toBeLessThanOrEqual(1);
}, 60_000);

it("u447_the_head_is_inert", async () => {
  await load();
  expect(await read(`(() => { const h=document.querySelector('.section-head'); const s=getComputedStyle(h); return {label:h.textContent,icon:h.querySelector('.icon').getBoundingClientRect().width,height:h.getBoundingClientRect().height,size:s.fontSize,spacing:s.letterSpacing,focus:h.querySelector('button,[tabindex]')!==null,rule:getComputedStyle(h,'::after').backgroundColor}; })()`)).toMatchObject({ label: "WORKSTREAMS", icon: 16, height: 32, size: "11px", spacing: "1px", focus: false });
}, 60_000);

it("u448_larger_names_fit_at_252", async () => {
  for (const scheme of ["light", "dark"]) for (const width of [1280, 700]) {
    await load("tree-40", width, scheme);
    await read(`document.querySelector('.rail').style.width = '252px'`);

    const measured = await read<{ heights: number[]; sizes: string[]; overflow: boolean; checks: Record<string, {status: string}> }>(`(() => {
      const rail=document.querySelector('.rail');
      return { heights:[...document.querySelectorAll('.rail-row,.rail-fold')].map(r=>r.getBoundingClientRect().height),
        sizes:[...document.querySelectorAll('.rail-row .name')].map(n=>getComputedStyle(n).fontSize),
        overflow:rail.scrollWidth>rail.clientWidth,checks:window.__checks() };
    })()`);

    expect(measured.heights.every(h=>h===32)).toBe(true);
    expect(measured.sizes.every(s=>s==="13px")).toBe(true);
    expect(measured.overflow).toBe(false);

    for (const id of ["D1","D2","D5","D6","D8","D9","D10"]) expect(measured.checks[id]?.status, `${id} ${scheme} ${width}`).toBe("pass");
    await browser("screenshot", join(railArt, `rail-${scheme}-${width}.png`));
    writeFileSync(join(railArt, `rail-${scheme}-${width}.checks.json`), JSON.stringify(measured.checks));
  }
}, 120_000);

it("u446_working_stays_distinct_from_needs_you_at_every_angle", async () => {
  for (const scheme of ["light", "dark"]) {
    await load("tree-40", 1280, scheme);

    for (const angle of [0, 120, 240]) {
      const result = await read<{ share: number; png: string }>(`(async () => {
        const angle=${angle};
        const ground=getComputedStyle(document.documentElement).getPropertyValue('--ground').trim();
        const grey=[];
        const canvas=document.createElement('canvas'); canvas.width=128; canvas.height=64;
        const row=canvas.getContext('2d');
        for (const [n,drawing] of ['quarter','disc'].entries()) {
          const mark=document.querySelector('.glyph[data-drawing="'+drawing+'"]');
          const svg=mark.querySelector('svg').cloneNode(true);
          svg.setAttribute('xmlns','http://www.w3.org/2000/svg');
          svg.setAttribute('width','64'); svg.setAttribute('height','64');
          svg.style.color=getComputedStyle(mark).color;
          if(drawing==='quarter') svg.querySelector('path').setAttribute('transform','rotate('+angle+' 8 8)');
          const image=new Image();
          await new Promise((ok,fail)=> {image.onload=ok;image.onerror=fail;image.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(new XMLSerializer().serializeToString(svg).replaceAll('var(--ground)',ground));});
          const tile=document.createElement('canvas');tile.width=tile.height=64;const ctx=tile.getContext('2d');
          ctx.fillStyle=ground;ctx.fillRect(0,0,64,64);ctx.drawImage(image,0,0,64,64);
          row.drawImage(tile,n*64,0);
          const pixels=ctx.getImageData(0,0,64,64).data;const values=[];
          for(let i=0;i<pixels.length;i+=4) values.push(Math.round(.299*pixels[i]+.587*pixels[i+1]+.114*pixels[i+2]));
          grey.push(values);
        }
        return {share:grey[0].filter((v,i)=>Math.abs(v-grey[1][i])>64).length/grey[0].length,png:canvas.toDataURL().split(',')[1]};
      })()`);

      expect(result.share, `${scheme} ${angle}`).toBeGreaterThan(0.04);
      writeFileSync(join(art, `angle-${scheme}-${angle}.png`), Buffer.from(result.png, "base64"));
    }
  }
}, 90_000);

it("u448_rows_are_32px_in_every_state", async () => {
  await load();
  await read(`document.querySelector('[data-id="tokens"]').click()`);
  await read(`(() => { for(const c of document.querySelectorAll('[data-pads-control]')) c.click(); })()`);
  const readBoxes = `(() => [...document.querySelectorAll('.rail-row,.rail-fold,.rail-leaf')].map(r=>({height:r.getBoundingClientRect().height,top:r.getBoundingClientRect().top})))()`;
  const before = await read<{height:number;top:number}[]>(readBoxes);
  expect(before.every(b=>b.height===32)).toBe(true);
  await browser("hover", '[data-id="logins"]');
  await read(`document.querySelector('[data-id="logins"]').click()`);
  expect(await read(readBoxes)).toEqual(before);
}, 60_000);
