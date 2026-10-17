import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";

import { captureDir } from "../testing/captures";
import { appServer, type AppServer } from "../testing/appServer";

const exec = promisify(execFile);

const profile = mkdtempSync(join(tmpdir(), "rail-browser-"));

const session = `rail-${process.pid}`;

const art = captureDir("U446");

const railArt = captureDir("U448");

let server: AppServer;

let origin: string;

const browser = async (...args: string[]) => (await exec("agent-browser", ["--session", session, "--json", ...args], { maxBuffer: 8 * 1024 * 1024 })).stdout;

const read = async <T,>(expression: string): Promise<T> => {
  // SAFETY: agent-browser's JSON envelope carries the result of the constant page expression below.
  const reply = JSON.parse(await browser("eval", expression)) as { success: boolean; data: { result: T }; error: string | null };

  if (!reply.success) throw new Error(reply.error ?? "browser evaluation failed");

  return reply.data.result;
};

const load = async (seed = "tree-40", scheme = "light") => {
  await browser("set", "media", scheme);
  await browser("set", "viewport", "1280", "800");
  await browser("open", `${origin}/harness.html?seed=${seed}`);
  await browser("wait", "--fn", "Boolean(window.__fake) && document.querySelectorAll('.rail-row').length > 2");
};

beforeAll(async () => {
  server = await appServer();
  origin = server.resolvedUrls.local[0]!;
  await browser("--profile", profile, "open", origin);

  if (art) mkdirSync(art, { recursive: true });

  if (railArt) mkdirSync(railArt, { recursive: true });
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
}, 60_000);

it("u447_the_head_is_inert", async () => {
  await load();
  expect(await read<boolean>(`document.querySelector('.section-head').querySelector('button,[tabindex]') === null`)).toBe(true);
}, 60_000);

it("u448_the_narrow_rail_passes_the_checks", async () => {
  for (const scheme of ["light", "dark"]) {
    await load("tree-40", scheme);
    await read(`document.querySelector('.rail').style.width = '252px'`);

    const measured = await read<{ checks: Record<string, {status: string}> }>(`({ checks: window.__checks() })`);

    for (const id of ["D1","D2","D5","D6","D8","D9","D10"]) expect(measured.checks[id]?.status, `${id} ${scheme}`).toBe("pass");

    if (railArt) await browser("screenshot", join(railArt, `rail-${scheme}-1280.png`));

    if (railArt) writeFileSync(join(railArt, `rail-${scheme}-1280.checks.json`), JSON.stringify(measured.checks));
  }
}, 120_000);

it("u446_working_stays_distinct_from_needs_you_at_every_angle", async () => {
  for (const scheme of ["light", "dark"]) {
    await load("tree-40", scheme);

    for (const angle of [0, 120, 240]) {
      const result = await read<{ share: number }>(`(async () => {
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
        canvas.id='glyph-comparison'; canvas.setAttribute('aria-label','Working and needs-you comparison');
        Object.assign(canvas.style,{position:'fixed',left:'600px',top:'16px',zIndex:'1000'});
        document.body.append(canvas);
        return {share:grey[0].filter((v,i)=>Math.abs(v-grey[1][i])>64).length/grey[0].length};
      })()`);

      expect(result.share, `${scheme} ${angle}`).toBeGreaterThan(0.04);

      if (art) await browser("screenshot", join(art, `angle-${scheme}-${angle}.png`));
      await read(`document.querySelector("#glyph-comparison").remove()`);
    }
  }
}, 90_000);

it("u448_dense_failure_is_visible_at_supported_viewports", async () => {
  await load("tree-40");
  await read(`(() => { window.__fake.failNext(-32003, 'name already taken'); document.querySelector('.rail button[aria-label="Add Workstream"]').click(); })()`);
  await browser("wait", "--text", "name already taken");
  expect(await read<string>(`document.querySelector('.rail [role="alert"]').textContent`)).toContain("name already taken");

  if (railArt) {
    await browser("screenshot", join(railArt, "failure-1280.png"));
    writeFileSync(join(railArt, "failure-1280.checks.json"), JSON.stringify(await read("window.__checks()")));
  }
}, 60_000);
