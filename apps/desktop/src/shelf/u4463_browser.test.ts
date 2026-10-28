import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { shelfBrowser } from "./u371Browser";
import { captureDir } from "../testing/captures";

const { browser, evaluate, settle, openShelf } = shelfBrowser();

const dir = captureDir("U4463");

const capture = async (name: string) => {
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  await browser("screenshot", join(dir, `${name}.png`));
  writeFileSync(join(dir, `${name}.checks.json`), JSON.stringify(await evaluate("window.__checks()"), null, 2));
};

const cases = dir ? [["tree-40", 240], ["tree-40", 320], ["empty-project", 240], ["empty-project", 320]] as const : [["tree-40", 320]] as const;

it.each(cases)("u4463_space_requests_auto_once_from_the_head_%s_%s", async (seed, width) => {
  await openShelf(seed, 288, width, 1512, "dark");
  await browser("set", "viewport", "1512", "950");

  // The empty seed's existing Workstream action supplies the scenario's scoped Workstream.
  if (seed === "empty-project") {
    await evaluate(`window.__fake.app.rpc('rail.createWorkstream', {name:'Research', parent:null})`);
    await settle();
  }

  const target = seed === "tree-40" ? '.rail-row[data-id="backend"]' : '.rail-row[data-id="n1"]';
  await browser("wait", target);
  await browser("click", `${target} .row-state`);
  await browser("wait", ".shelf-bar [role=switch]");
  // Like u3310's App-seam observer, acknowledge Auto through the Workstream event.
  await evaluate(`(async () => {
    const tree = await window.__fake.app.rpc('rail.tree', {});
    window.__fake.app.handlers['workstream.setAuto'] = ({id, auto}) => {
      tree.find(node => node.id === id).auto = auto;
      window.__fake.app.handlers['rail.tree'] = () => tree;
      window.__fake.emit({actor:{kind:'user',id:'you',parent:null},name:'workstream.updated',data:{id,auto}});
      return null;
    };
  })()`);
  await settle();
  await capture(`${seed}-${width}-todos`);
  await evaluate(`document.querySelector('.shelf-bar [role=switch]').focus()`);
  await browser("press", "Space");
  await browser("wait", "--fn", `document.querySelector('.shelf-bar [role=switch]').getAttribute('aria-checked') === 'true'`);
  expect(await evaluate(`window.__fake.app.calls.filter(c => c.method === 'workstream.setAuto').map(c => c.params.auto)`)).toEqual([true]);

  if (width === 240) {
    await evaluate(`window.__fake.failNext(-32003, 'Supervisor unavailable; start it and retry')`);
    await browser("click", ".shelf-bar [role=switch]");
    await browser("wait", ".shelf-bar [role=alert]");
    await capture(`${seed}-${width}-refused`);
    await browser("hover", ".shelf-bar [role=alert]");
    await browser("wait", "[role=tooltip]");
    await capture(`${seed}-${width}-refused-detail`);
  }

  await browser("click", "#shelf-tab-pads");
  await browser("wait", ".pads-tab");
  await settle();
  await capture(`${seed}-${width}-pads`);
}, 60_000);
