import { captureDir } from "../testing/captures";
import { openLane } from "../todos/laneBrowser";
import { agent, door, workstream } from "../testing/nodes";
import { openProjectPage } from "../testing/menuProbe";
import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { mountNavigation } from "../testing/navigationFixture";

afterEach(() => { cleanup(); localStorage.clear(); sessionStorage.clear(); });

it("u4454a_the_centre_has_no_time_timeline_or_back_to_ask", async () => {
  const { connected, daemon, nodes } = await mountNavigation(true, 0);
  nodes.push(
    workstream("home"),
    agent("a0", "needs-you", "ready", { parent: "home" }),
    door("running", "working", "Working"),
    door("stopped", "idle", "Stopped"),
  );
  await connected().rail.refresh();
  const draft = "  Keep this exact draft\nfor my original Project 🦉";
  fireEvent.input(screen.getByRole("textbox", { name: "Ask" }), { target: { value: draft } });

  for (const id of ["a0", "home", "stopped", null]) {
    connected().rail.select(id);
    await waitFor(() => expect(connected().rail.selected()).toBe(id));

    for (const name of ["Time", "Timeline", "Back to Ask"]) {
      expect(screen.queryByRole("tab", { name })).toBeNull();
      expect(screen.queryByRole("button", { name })).toBeNull();
      expect(screen.queryByRole("region", { name })).toBeNull();
    }
  }

  connected().rail.select("a0");
  fireEvent.click(screen.getByRole("button", { name: /^Overview/ }));
  const field = await screen.findByRole("textbox", { name: "Ask" });

  if (!(field instanceof HTMLTextAreaElement)) throw new Error("Ask must be editable");
  expect(field.value).toBe(draft);
  expect(connected().rail.selected()).toBeNull();
  expect(connected().project.path).toBe("/p");
  expect(daemon.calls.filter(call => ["agent.spawn", "terminal.open", "ask.send", "message.send"].includes(call.method))).toHaveLength(0);
});

it.each(["project-settings", "import-work", "app-settings"])("u4315a_requested_screens_close_themselves: %s", async command => {
  const { connected, daemon } = await mountNavigation();

  if (command === "import-work") daemon.handlers["project.importDiscover"] = () => new Promise(() => {});
  connected().rail.select("a0");

  if (command === "app-settings") window.dispatchEvent(new Event("open-app-settings"));
  else openProjectPage(command, "/p");
  const name = command === "project-settings" ? "Project settings" : command === "import-work" ? "Import Claude Code work" : "Settings";
  const view = await screen.findByRole("region", { name });
  fireEvent.click(within(view).getByRole("button", { name: command === "app-settings" ? "← Back" : "Close" }));
  await waitFor(() => expect(screen.queryByRole("region", { name })).toBeNull());
});

it.each(["success", "refused"])("u4355_close_keeps_pending_import: %s", async outcome => {
  const { connected, daemon, nodes } = await mountNavigation(false, 0);

  const candidates = [
    { source: "source-first", revision: "revision-first", title: "First work", cwd: "", last_activity_ms: 2n },
    { source: "source-second", revision: "revision-second", title: "Second work", cwd: "sub", last_activity_ms: 1n },
  ];

  daemon.handlers["project.importDiscover"] = () => ({ candidates, excluded: [] });
  let settle!: (result: import("@contracts/project/ImportResult").ImportResult) => void;
  daemon.handlers["project.importCommit"] = () => new Promise(resolve => { settle = resolve; });
  const commits = () => daemon.calls.filter(call => call.method === "project.importCommit");
  connected().rail.select("a0");
  openProjectPage("import-work", "/p");
  const region = await screen.findByRole("region", { name: "Import Claude Code work" });
  const panel = within(region);
  await panel.findByRole("checkbox", { name: /First work/ });
  fireEvent.click(panel.getByRole("button", { name: "Last month" }));
  await waitFor(() => expect(connected().importing.loading()).toBe(false));
  fireEvent.click(panel.getByText("First work"));
  await panel.findByRole("button", { name: "Import 1" });
  fireEvent.click(panel.getByText("Second work"));
  const back = panel.getByRole("button", { name: "Close" });
  fireEvent.click(await panel.findByRole("button", { name: "Import 2" }));
  await waitFor(() => expect(commits()).toHaveLength(1));
  fireEvent.click(back);
  fireEvent.keyDown(back, { key: "Enter", code: "Enter" });
  fireEvent.keyDown(region, { key: "Escape", code: "Escape" });
  // U4453b uses the same pending-import guard through both new return paths.
  fireEvent.keyDown(document.body, { key: "k", code: "KeyK", metaKey: true });
  fireEvent.keyDown(document.body, { key: "a", code: "KeyA" });
  fireEvent.click(screen.getByRole("button", { name: /^Overview/ }));
  expect(screen.getByRole("region", { name: "Import Claude Code work" })).toBe(region);
  expect(connected().importing.pending()).toBe(true);
  expect(connected().rail.selected()).toBe("a0");
  expect(connected().project.path).toBe("/p");
  expect(connected().importing.period()).toBe("month");
  expect([...connected().importing.selected()]).toEqual([
    ["source-first", { revision: "revision-first", title: "First work" }],
    ["source-second", { revision: "revision-second", title: "Second work" }],
  ]);
  expect(commits()[0]?.params).toEqual({ selections: [
    { source: "source-first", revision: "revision-first" },
    { source: "source-second", revision: "revision-second" },
  ] });

  if (outcome === "success") nodes.push(workstream("imported"), agent("imported-agent", "idle", "", { parent: "imported" }));
  settle({ outcomes: candidates.map(candidate => outcome === "success"
    ? { source: candidate.source, workstream: "imported", agent: "imported-agent", error: null }
    : { source: candidate.source, workstream: null, agent: null, error: { code: -32003, message: "Source changed", outcome: "failed" } }) });
  await waitFor(() => expect(connected().importing.pending()).toBe(false));

  if (outcome === "success") {
    await waitFor(() => expect(connected().rail.selected()).toBe("imported-agent"));
    expect(region.isConnected).toBe(false);
  } else {
    expect(screen.getByRole("region", { name: "Import Claude Code work" })).toBe(region);
    expect(connected().rail.selected()).toBe("a0");
    expect(panel.getAllByRole("alert").length).toBeGreaterThan(0);
    expect(panel.getByRole("button", { name: "Import 2" })).toHaveProperty("disabled", false);
    fireEvent.click(back);
    await waitFor(() => expect(region.isConnected).toBe(false));
    expect(connected().rail.selected()).toBe("a0");
    openProjectPage("import-work", "/p");
    await waitFor(() => expect(connected().importing.loading()).toBe(false));
    const reopened = within(screen.getByRole("region", { name: "Import Claude Code work" }));
    expect(reopened.getByRole("checkbox", { name: /First work/ })).toHaveProperty("checked", true);
    expect(reopened.getByRole("checkbox", { name: /Second work/ })).toHaveProperty("checked", true);
    expect(reopened.getByRole("button", { name: "Last month" }).getAttribute("aria-pressed")).toBe("true");
    expect(connected().project.path).toBe("/p");
  }

  expect(commits()).toHaveLength(1);
});

it.skipIf(!captureDir("U4355"))("u4355_rendered_pending_import", async () => {
  const { mkdirSync, writeFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { startAppServer } = await import("../testing/appServer");
  const baseline = process.env.ROUNDUP_BASELINE_ROOT ? await startAppServer({ root: process.env.ROUNDUP_BASELINE_ROOT }) : null;
  const page = await openLane(1512, "dark", "u4355");
  const headUrl = await page.evaluate<string>("location.origin");
  const dir = captureDir("U4355")!;

  try {
    for (const [side, url] of [...(baseline ? [["base", baseline.resolvedUrls.local[0]]] : []), ["head", headUrl]]) {
      const output = join(dir, side!);
      mkdirSync(output, { recursive: true });
      await page.browser("record", "start", join(output, "import.webm"));
      await page.browser("set", "media", "dark");

      for (const outcome of ["success", "refused"]) {
        await page.evaluate("localStorage.clear()");
        await page.browser("open", `${url}/harness.html?seed=tree-40`);
        await page.until("!!document.querySelector('.rail-row[data-id=tokens]')");
        await page.browser("click", ".rail-row[data-id=tokens] .row-state");
        await page.evaluate(`(() => {
          const app = window.__fake.app;
          app.handlers['project.importDiscover'] = () => ({ candidates: Array.from({length:10},(_,n) => ({source:'source-'+n,revision:'revision-'+n,title:('Review changes '+n+' 会話の変更を確認 with a long conversation title ').repeat(8),cwd:'src',last_activity_ms:BigInt(Date.now()-60_000)})),excluded:[] });
          app.handlers['project.importCommit'] = params => new Promise(resolve => { window.__settleImport = () => resolve({outcomes:params.selections.map(entry => ${outcome === "success" ? "({source:entry.source,workstream:'backend',agent:'tokens',error:null})" : "({source:entry.source,workstream:null,agent:null,error:{code:-32003,message:'The saved conversation changed. Refresh and select the conversation again.',outcome:'failed'}})"})}); });
          window.dispatchEvent(new CustomEvent('open-project-page', {detail:{path:document.querySelector('.project-tab[data-selected=true]').dataset.path,command:'import-work'}}));
          return true;
        })()`);
        await page.until("document.querySelectorAll('.import-check').length === 10");
        await page.browser("find", "role", "button", "click", "--name", "Last month");
        await page.until("document.querySelectorAll('.import-check').length === 10");
        await page.browser("click", ".import-list li:first-child .app-checkbox-label");
        await page.until("document.querySelector('.import-confirm').textContent.trim() === 'Import 1'");
        await page.browser("click", ".import-confirm");
        await page.until("!!window.__settleImport");

        const capture = async (step: string) => {
          writeFileSync(join(output, `${outcome}-${step}.checks.json`), JSON.stringify(await page.evaluate("window.__checks()")) + "\n");
          await page.browser("screenshot", join(output, `${outcome}-${step}.png`));
        };

        await page.evaluate("document.fonts.ready.then(() => true)");
        await capture("pending");
        const readBack = () => page.evaluate("(() => {const b=document.querySelector('.settings-head button'); if(!b)return null; const s=getComputedStyle(b);return {ariaDisabled:b.getAttribute('aria-disabled'),nativeDisabled:b.disabled,title:b.title,tabIndex:b.tabIndex,color:s.color,cursor:s.cursor,cjkFont:document.fonts.check('13px \"Noto Sans CJK JP\"')};})()");
        const restingBack = await readBack();
        // A real coordinate press can target the disabled control without waiting for it to enable.
        const box = await page.evaluate<{ x: number; y: number }>("(() => {const r=document.querySelector('.settings-head button').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()");
        await page.browser("mouse", "move", String(Math.round(box.x)), String(Math.round(box.y)));
        await page.browser("mouse", "down");
        await page.browser("mouse", "up");

        if (side === "head") expect(await page.evaluate("!!document.querySelector('.import-panel')")).toBe(true);

        writeFileSync(join(output, `${outcome}-back.json`), JSON.stringify({ resting: restingBack, hovered: await readBack() }) + "\n");
        await capture("attempted-back");
        const discoveries = (await page.calls("project.importDiscover")).length;
        await page.evaluate("(() => {window.__settleImport(); delete window.__settleImport; return true;})()");
        await page.until(outcome === "success" ? "!document.querySelector('.import-panel')" : side === "base" ? `window.__fake.app.calls.filter(call => call.method === 'project.importDiscover').length > ${discoveries}` : "!!document.querySelector('.import-panel [role=alert]') && !document.querySelector('.import-confirm').disabled");
        await capture("settled");
      }

      await page.browser("record", "stop");
    }
  } finally {
    await page.close();
    await baseline?.close();
  }
}, 180_000);
