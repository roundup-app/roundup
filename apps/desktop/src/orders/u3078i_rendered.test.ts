import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { captureDir } from "../testing/captures";
import type { Checks } from "../testing/checks";
import { progressSeed } from "../testing/progressSeed";
import { shelfBrowser } from "../shelf/u371Browser";

const ids = ["U4453b", "U3791b", "U3078i", "P3557c"];

const enabled = ids.some(id => captureDir(id));

const side = process.env["U3078I_SIDE"] === "base" ? "base" : "head";

const { browser, evaluate, rig } = shelfBrowser();

const seed = progressSeed({ project: "/Users/you/project", agent: "agent-1" });

it.skipIf(!enabled)("u3078i_rendered_open_inspect_resume", { retry: 0, timeout: 240_000 }, async () => {
  for (const fixture of ["agents-10", "tree-40"]) {
    const directories = ids.flatMap(id => {
      const path = captureDir(id);

      return path ? [join(path, side)] : [];
    });

    for (const path of directories) mkdirSync(path, { recursive: true });

    const capture = async (name: string) => {
      const checks = await evaluate<Checks>("window.__checks()");

      for (const path of directories) {
        writeFileSync(join(path, `${fixture}-${name}.checks.json`), JSON.stringify(checks) + "\n");
        await browser("screenshot", join(path, `${fixture}-${name}.png`));
      }

      return checks;
    };

    const wait = (condition: string) => browser("wait", "--fn", condition);
    const click = (label: string) => browser("find", "role", "button", "click", "--name", label, "--exact");
    await browser("set", "viewport", "1512", "950");
    await browser("set", "media", "dark");
    await browser("close");
    await browser("record", "start", join(directories[0]!, `${fixture}-progress.webm`), `${process.env["U3078I_ORIGIN"] ?? rig.server.resolvedUrls.local[0]}harness.html?view=workstreams&menu=1&seed=${fixture}`);
    await browser("set", "viewport", "1512", "950");
    await wait("!!window.__fake && !!document.querySelector('.rail')");
    await browser("set", "media", "dark");
    await evaluate(`(async () => {
      const app = window.__fake.app;
      window.__fake.failNext(-32003, 'Resume refused because the original Agent is stopped. Start that Agent and try Resume again. Full retained diagnostic: no continuation was sent.');
      const refused = await app.rpc('message.progress', null).catch(error => error);
      window.__fake.failNext(-32004, 'The Resume reply was lost. Its original Agent and action must be reconciled before another request.');
      const unknown = await app.rpc('message.progress', null).catch(error => error);
      const tree = app.handlers['rail.tree'];
      const chosen = (await tree({})).find(node => node.kind === 'agent' && node.status !== null);
      window.progressAgent = chosen.id;
      app.handlers['rail.tree'] = async args => (await tree(args)).map(node => ({...node, name: 'Login repair overlapping sibling Agent name with Unicode 草稿 — ' + node.name}));
      const seed = ${JSON.stringify(seed)};
      let calls = 0;
      app.handlers['message.progress'] = () => seed.progress;
      app.handlers['message.reconcileWork'] = () => calls > 2 ? {...seed.plan, actions: [{...seed.action, decision:'decided'}]} : seed.plan;
      app.handlers['message.resumeWork'] = () => { calls++; if (calls === 1) throw refused; if (calls === 2) throw unknown; return {decision:{id:'decided',request:'r',actions:[seed.action.id],message:7},reconciliation:seed.plan}; };
      app.handlers['deliverable.resolve'] = () => ({kind:'unavailable',cause:'missing-revision'});
      window.__fake.emit({actor:{kind:'user',id:'you',parent:null},name:'rail.changed'});
      return true;
    })()`);
    await wait("!!document.querySelector('.rail-row[data-id=\"' + window.progressAgent + '\"]')");
    const row = await evaluate<string>("'.rail-row[data-id=\"' + window.progressAgent + '\"]'");
    await browser("click", row);
    await browser("focus", row);
    await browser("press", "Shift+F10");

    if (side === "base") {
      await wait("window.__fake.app.shownMenus.length > 0");

      for (const path of directories) writeFileSync(join(path, `${fixture}-menu.json`), JSON.stringify(await evaluate("window.__fake.app.shownMenus.at(-1)")) + "\n");
    } else await wait("!!document.querySelector('[role=menuitem]')");
    const reachable = await evaluate<boolean>("[...document.querySelectorAll('[role=menuitem]')].some(item => item.textContent.includes('Work progress'))");
    await capture("menu");

    if (!reachable) {
      for (const path of directories) writeFileSync(join(path, `${fixture}-observer.json`), JSON.stringify({status:"failed", cause:"Baseline Rail menu has no Work progress action; Progress is unreachable."}) + "\n");
      await browser("record", "stop");

      for (const path of directories.slice(1)) copyFileSync(join(directories[0]!, `${fixture}-progress.webm`), join(path, `${fixture}-progress.webm`));
      expect(side).toBe("base");
      continue;
    }

    await browser("find", "role", "menuitem", "click", "--name", "Work progress", "--exact");
    await wait("!!document.querySelector('.progress-section')");
    await capture("open");
    await browser("click", ".progress-earlier [data-part=trigger]");
    await click("Open notes v1");
    await wait("!!document.querySelector('.progress-row [role=alert]')");
    await capture("evidence-unavailable");
    await click("Resume unfinished work");
    await wait("!!document.querySelector('.progress-status [role=alert]') || document.querySelector('.progress-status')?.getAttribute('role') === 'alert'");
    await browser("hover", ".progress-status [role=alert]");
    await wait("document.querySelector('[role=tooltip]')?.getAttribute('data-state') === 'open'");
    await capture("refused");
    await browser("hover", ".progress-head");
    await wait("document.querySelector('.progress-head button')?.getAttribute('aria-disabled') !== 'true'");
    await click("Try resuming again");
    await wait("document.querySelector('.progress-status')?.textContent.includes('may have reached')");
    await browser("hover", ".progress-status [role=alert]");
    await wait("document.querySelector('[role=tooltip]')?.getAttribute('data-state') === 'open'");
    const checks = await capture("unknown");
    await browser("hover", ".progress-head");

    for (const id of ["D2", "D5", "D6"] as const) expect(checks[id].status, id).toBe("pass");
    expect(await evaluate<number>("window.__fake.app.calls.filter(call => call.method === 'message.resumeWork').length")).toBe(2);
    await browser("click", '.progress-status button[aria-label="Clear error"]');
    await capture("dismissed");
    await wait("document.querySelector('.progress-head button')?.getAttribute('aria-disabled') !== 'true'");
    await click("Try resuming again");
    await wait("!document.querySelector('.progress-head button')");
    await capture("resumed");
    await browser("record", "stop");

    for (const path of directories.slice(1)) copyFileSync(join(directories[0]!, `${fixture}-progress.webm`), join(path, `${fixture}-progress.webm`));
  }
});
