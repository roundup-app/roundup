import { afterAll, beforeAll, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromePath, openPage } from "../testing/chromePage";
import type { ChromePage } from "../testing/chromePage";
import { captureDir } from "../testing/captures";

let page: ChromePage;
const art = captureDir("U466");
beforeAll(async () => {
  const chrome = chromePath();
  if (!chrome) throw new Error("U466 requires isolated Chromium");
  page = await openPage(chrome);
}, 90_000);
afterAll(async () => { await page?.close(); });

const load = async (seed = "tree-40", viewport = 1280, scheme: "light" | "dark" = "light", width = 288) => {
  await page.scheme(scheme);
  await page.load("/harness.html?seed=" + seed, viewport, 800);
  await page.until("() => document.querySelectorAll('.rail-row').length > 8");
  await page.call("() => document.querySelector('.rail-row[data-id]').click()");
  await page.until("() => Boolean(document.querySelector('.rail-row[data-selected=\"true\"]'))");
  await page.call("(width) => { document.querySelector('.rail').style.width = width + 'px'; }", width);
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
  for (const width of [252,288,480]) { await load("tree-40",1280,"light",width); expect((await read()).padding).toEqual(["0px","0px"]); }
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
  for(const width of [252,288,480]) { await load("tree-40",1280,"light",width); expect((await read()).overflow).toBe(false); }
},60_000);
it("u466_ten_agents_keep_selection_and_attention_distinct", async () => {
  await load("agents-10");
  expect(await page.call(`() => ({selected:document.querySelectorAll('.rail-row[data-selected="true"]').length,attention:[...document.querySelectorAll('.rail .glyph.ink')].map(g=>g.getAttribute('aria-label'))})`)).toEqual({selected:1,attention:expect.arrayContaining(["Error","Needs-you"])});
});
it("u466_rendered_states_keep_checks_and_failure_text", async () => {
  for(const scheme of ["light","dark"] as const) for(const viewport of [1280,1440]) for(const width of [252,288,480]) {
    await load("tree-40",viewport,scheme,width);
    const checks=await page.call<Record<string,{status:string}>>("() => window.__checks()");
    for(const id of ["D2","D5","D6"]) expect(checks[id]?.status,id).toBe("pass");
    if(art) {
      mkdirSync(art,{recursive:true});
      const name=`tree-40-${viewport}-${scheme}-${width}`;
      writeFileSync(join(art,name+".png"),Buffer.from(await page.shot(),"base64"));
      writeFileSync(join(art,name+".checks.json"),JSON.stringify(checks));
    }
  }
},180_000);
