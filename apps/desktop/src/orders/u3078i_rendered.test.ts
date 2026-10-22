import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { captureDir } from "../testing/captures";
import type { Checks } from "../testing/checks";
import { progressSeed } from "../testing/progressSeed";
import { shelfBrowser } from "../shelf/u371Browser";

/**
 * U3078i's rendered observer for the design critic: the Order of one of ten Agents with long names, open → inspect → resume
 * at 1512×950 in dark mode on `agents-10`, in one isolated headless session. `U3078I_SIDE=base` runs the same steps on a
 * checkout without the Progress section. Readings, screenshots and a video go to the capture directory of `captureDir`.
 */
const art = captureDir("U3078i");

const side = process.env["U3078I_SIDE"] === "base" ? "base" : "head";

const rendered = art ? it : it.skip;

const { browser, evaluate, rig } = shelfBrowser();

const seeded = progressSeed({ project: "/Users/you/project", agent: "agent-1" });

const LONG = "Login repair for the production cluster, overlapping its sibling agents of nearly the same long name";

const install = `(async () => {
  const { app } = window.__fake;
  // An RpcError the Daemon answers with: the harness builds one for its next call.
  window.__fake.failNext(-32000, "resume was not accepted: the Agent is stopped; start it again first");
  const refusal = await app.rpc("message.progress", null).catch((error) => error);
  const seed = ${JSON.stringify(seeded)};
  const tree = app.handlers["rail.tree"];
  let resumes = 0;
  app.handlers["rail.tree"] = async (args) => (await tree(args)).map((node, index) => node.id === "agent-1"
    ? { ...node, name: ${JSON.stringify(LONG)}, work: { kind: "work", title: "Fix login", ask: "Fix login for every sign-in path", done: "Login passes", limits: ["No deployment"] } }
    : { ...node, name: node.name + " overlapping name " + (index % 3) });
  app.handlers["message.progress"] = () => seed.progress;
  app.handlers["message.reconcileWork"] = () => resumes > 1 ? { ...seed.plan, actions: [{ ...seed.action, decision: "d1" }] } : seed.plan;
  app.handlers["deliverable.resolve"] = ({ id }) => id === "output-r-gone" ? { kind: "unavailable", cause: "missing-revision" } : { kind: "retained", path: "/p/output.txt", sha256: "0" };
  app.handlers["message.resumeWork"] = () => {
    resumes += 1;
    if (resumes === 1) throw refusal;
    return { decision: { id: "d1", request: "r", actions: [seed.action.id], message: 7 }, reconciliation: seed.plan };
  };
  window.__fake.emit({ actor: { kind: "user", id: "you", parent: null }, name: "rail.changed" });
  return true;
})()`;

rendered("u3078i_rendered_open_inspect_resume", async () => {
  const directory = join(art!, side);
  mkdirSync(directory, { recursive: true });

  const step = async (name: string) => {
    writeFileSync(join(directory, `${name}.checks.json`), JSON.stringify(await evaluate<Checks>("window.__checks()")) + "\n");
    await browser("screenshot", join(directory, `${name}.png`));
  };

  const click = async (script: string) => { await evaluate(`(() => { ${script}; return true; })()`); };

  await browser("set", "viewport", "1512", "950");
  await browser("set", "media", "dark");
  await browser("record", "start", join(directory, "open-inspect-resume.webm"), `${rig.server.resolvedUrls!.local[0]}harness.html?seed=agents-10`);
  await browser("wait", "--fn", "!!window.__fake");
  await browser("wait", ".rail");
  await evaluate(install);
  await browser("wait", "--fn", "!!document.querySelector('.rail-row[data-id=\"agent-1\"]')");
  await browser("click", '.rail-row[data-id="agent-1"]');
  // agent-1 is in error, so its Order shows inline in the pane, as for any closed Agent.
  await browser("wait", "--fn", "!!document.querySelector('.order-overview')");

  if (side === "base") {
    await step("open");
    await browser("record", "stop");

    return;
  }

  await browser("wait", "--fn", "!!document.querySelector('.progress-section')");
  await step("open");
  const checks = await evaluate<Checks>("window.__checks()");

  for (const id of ["D2", "D5", "D6"] as const) expect(checks[id].status, id).toBe("pass");

  await browser("click", ".progress-earlier [data-part=trigger]");
  await browser("wait", "--fn", "document.querySelectorAll('.progress-earlier .progress-row').length > 0");
  await step("earlier-versions");
  await click("[...document.querySelectorAll('.progress-evidence')].find(b => b.textContent === 'notes v1').click()");
  await browser("wait", "--fn", "!!document.querySelector('.progress-row .progress-failure')");
  await step("evidence-unavailable");
  // The Daemon refuses the first Resume as it does for a stopped Agent.
  await browser("click", ".progress-head [data-button=primary]");
  await browser("wait", "--fn", "!!document.querySelector('.progress-section > .progress-failure')");
  await step("resume-failed");
  expect(await evaluate<boolean>("document.activeElement === document.querySelector('.progress-head [data-button=primary]')")).toBe(true);
  await browser("click", ".progress-head [data-button=primary]");
  await browser("wait", "--fn", "!!document.querySelector('.progress-status')");
  await step("resumed");
  await browser("record", "stop");
}, 240_000);
