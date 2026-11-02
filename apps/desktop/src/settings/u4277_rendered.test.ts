import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { captureDir } from "../testing/captures";
import { openLane } from "../todos/laneBrowser";

it.skipIf(!captureDir("U4277a"))("u4277a_u4277b_u4277c_requested_screens_dark", { timeout: 240_000, retry: 0 }, async () => {
  const lane = await openLane(1512, "dark", "builder-4277");
  const only = (process.env.ROUNDUP_CAPTURE_SCREENS ?? "").split(",").filter(Boolean);
  const phase = process.env.ROUNDUP_CAPTURE_PHASE ?? "head";
  await lane.evaluate(`localStorage.setItem("roundup:app-settings", JSON.stringify({mode:"dark"}))`);
  const origin = await lane.evaluate<string>("location.origin");

  const capture = async (id: string, name: string) => {
    await lane.browser("set", "media", "dark");
    const dir = join(captureDir(id)!, phase);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${name}.checks.json`), JSON.stringify(await lane.evaluate("window.__checks()")) + "\n");
    await lane.browser("screenshot", join(dir, `${name}.png`));
  };

  try {
    const videoDir = join(captureDir("U4277a")!, phase);
    mkdirSync(videoDir, { recursive: true });
    await lane.browser("record", "start", join(videoDir, `screens${only.length ? "-" + only.join("-") : ""}.webm`));

    for (const seed of (only.length && !only.includes("settings") ? [] : ["tree-40", "tabs-8", "first-run", "agents-10", "conflict"])) {
      await lane.browser("open", `${origin}/harness.html?view=workstreams&items=1&tabs=1&seed=${seed}`);
      await lane.until("!!window.__fake && !!document.querySelector('.window')");

      if (seed !== "first-run") await lane.until("!!document.querySelector('.ask-input')");
      await lane.browser("set", "media", "dark");
      await lane.evaluate("window.dispatchEvent(new Event('open-app-settings'))");
      await lane.until("!!document.querySelector('.settings-view')");

      await lane.browser("focus", '[role=tab][data-value="Agents"]');

      for (const [key, pages] of [["ArrowDown", ["Terminal", "Shortcuts", "Appearance"]], ["ArrowUp", ["Shortcuts", "Terminal", "Agents"]]] as const) {
        for (const page of pages) {
          await lane.browser("press", key);
          await lane.until(`document.activeElement?.dataset.value === "${page}" && document.activeElement?.getAttribute('aria-selected') === 'true'`);
        }
      }

      for (const section of ["Agents", "Terminal", "Shortcuts", "Appearance"]) {
        await lane.browser("click", `[role=tab][data-value="${section}"]`);
        await lane.until(`!!document.querySelector('[role=tab][data-value="${section}"][aria-selected=true]')`);
        await lane.browser("press", "Tab");
        await lane.until("!!document.activeElement.closest('.settings-content')");
        expect(await lane.evaluate("!!document.activeElement.closest('[role=tabpanel]:not([hidden])')")).toBe(true);

        await capture("U4277a", `${seed}-${section}`);

        if (section === "Shortcuts" && seed === "tree-40") {
          await lane.browser("click", ".settings-shortcut button");
          await lane.until("!!document.querySelector('.settings-shortcut [aria-pressed=true]')");
          await capture("U4277a", "tree-40-shortcut-recording");
          await lane.browser("press", "Meta+q");
          await lane.until("!!document.querySelector('.settings-shortcut [aria-invalid=true]')");
          await capture("U4277a", "tree-40-shortcut-refusal");
          await lane.browser("press", "Escape");
          await lane.until("!!document.querySelector('.settings-view') && !!document.querySelector('.settings-shortcut [aria-pressed=false]')");
        }

        if (section === "Terminal" && seed === "tree-40") {
          await lane.evaluate(`(() => { const field = document.querySelector('input[aria-label="Font size"]'); field.value = '300'; field.dispatchEvent(new Event('input', {bubbles:true})); field.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter',bubbles:true})); return true; })()`);
          await lane.until("document.querySelector('.settings-view').textContent.includes('Choose a font size')");
          await capture("U4277a", "tree-40-size-refusal");
        }
      }

      await lane.browser("click", ".settings-back");
      await lane.until("!document.querySelector('.settings-view')");
      await lane.evaluate(`(() => {
        window.__fake.app.handlers['models.list'] = () => { throw new Error('Models could not be loaded because the configured engine is unavailable. Check the engine installation and reopen Settings to retry.'); };
        window.dispatchEvent(new Event('open-app-settings'));
        return true;
      })()`);
      await lane.until("!!document.querySelector('.settings-view')");
      await lane.browser("click", '[role=tab][data-value="Agents"]');

      if (seed === "tree-40") {
        await lane.until("document.querySelector('.settings-view').textContent.includes('Models could not be loaded')");
        await capture("U4277a", "tree-40-models-failure");
      }

      await lane.browser("press", "Escape");
      await lane.until("!document.querySelector('.settings-view')");
    }

    for (const [state, seed] of [["empty", "empty-project"], ["filled", "tree-40"]]) {
      for (const command of ["ask-history", "resources", "made", "workstreams", "terminal-tabs", "import-work", "notes"]) {
        if (only.length && !only.includes(command)) continue;

        const selectedSeed = command === "resources" ? (state === "empty" ? "agents-10" : "resources") : command === "import-work" && state === "filled" ? "import-candidates" : command === "notes" && state === "filled" ? "note-queue" : seed;
        await lane.browser("open", `${origin}/harness.html?items=1&seed=${selectedSeed}`);
        await lane.until("!!window.__fake && !!document.querySelector('.ask-input')");

        if (state === "filled" && command === "notes") {
          await lane.evaluate(`(async () => { const {notesFor} = await import('/src/changes/notes.ts'); const comparison = {base:'base', oldPath:'src/retained.ts',newPath:'src/retained.ts',status:'modified',old:{kind:'text',revision:'old',text:'before\\n'},new:{kind:'text',revision:'new',text:'after\\n'}}; await notesFor(window.__fake.app,'/Users/you/harness').save('agent-4', {comparison, side:'new',start:1,end:1,source:'after',text:'Keep exact retained work 🐝 ' + 'Long note '.repeat(30)}); return true; })()`);
          await lane.browser("reload");
          await lane.until("!!document.querySelector('.ask-input')");
        }

        if (state === "filled" && command === "made") await lane.evaluate(`(() => { window.__fake.app.handlers['deliverable.list'] = () => [{ project:'/Users/you/harness', id:'published-result', maker:{kind:'user',id:'you',parent:null}, maker_name:'You', home:null, title:'Published result ' + '成果📖'.repeat(40), published_at:Date.now(), target:{kind:'external',url:'https://example.com/result',availability:'not-checked'} }]; return true; })()`);

        if (state === "filled" && command === "ask-history") await lane.evaluate(`(() => { window.__fake.app.handlers['ask.list'] = () => [{id:'asked-work', text:'Please inspect ' + 'long authored task '.repeat(30),at:BigInt(Date.now()),parts:[{text:'Please inspect ' + 'long authored task '.repeat(30),placement:{kind:'routed',workstream:'backend'},state:'typed'}]}]; return true; })()`);

        if (state === "filled" && command === "ask-history") await lane.evaluate(`(() => { window.__fake.emit({actor:{kind:'user',id:'you',parent:null}, name:'ask.changed',data:{ask:window.__fake.app.handlers['ask.list']()[0]}}); return true; })()`);

        if (command === "resources") {
          await lane.evaluate("window.dispatchEvent(new CustomEvent('open-project-page', {detail:{path:'/Users/you/harness', command:'view:workstreams'}}))");
          await lane.until("!!document.querySelector('.rail-row')");
          await lane.evaluate("document.querySelector('.rail-row[data-id=worktree-agent], .rail-row[data-id=agent-1]')?.click()");
        }

        await lane.evaluate(`window.dispatchEvent(new CustomEvent('open-project-page', {detail:{path:'/Users/you/harness',command:'${command === "import-work" ? command : "view:" + command}'}}))`);

        if (command === "notes" && phase === "head") await lane.until("!!document.querySelector('.note-recovery')");

        if (command === "resources") await lane.until("!!document.querySelector('.resource-inspection')");

        if (command === "import-work") await lane.until("!!document.querySelector('.import-panel') && !document.querySelector('.import-panel [aria-busy=true]')");

        if (command === "import-work") {
          await lane.evaluate(`Array.from(document.querySelectorAll('.settings-view button')).find(button => button.textContent === 'Refresh').click()`);

          if (state === "filled") await lane.until("!!document.querySelector('.import-check')");
        }

        await capture(command === "notes" ? "U4277b" : "U4277c", `${command}-${state}`);

        if (command === "import-work" && state === "filled") {
          await lane.until("!!document.querySelector('.import-check')");
          await lane.browser("click", ".import-check");
          await lane.evaluate(`(() => { window.__fake.app.handlers['project.importCommit'] = ({selections}) => ({outcomes:selections.map(item=>({source:item.source,workstream:null,agent:null,error:{code:-32003,message:'Storage unavailable. Free disk space and retry Import.',outcome:'failed'}}))}); return true; })()`);
          await lane.browser("click", ".import-confirm");
          await lane.until("!!document.querySelector('.import-panel [role=alert]')");
          await capture("U4277c", "import-partial-failure");
        }
      }
    }

  } finally { try { await lane.browser("record", "stop"); } finally { await lane.close(); } }
});


it.skipIf(!captureDir("U5560b"))("u5560b_expanded_pad_default_screens", { timeout: 180_000, retry: 0 }, async () => {
  const lane = await openLane(1512, "dark", "builder-5560-settings");
  const baseline = process.env.ROUNDUP_CAPTURE_PHASE === "base";
  const dir = join(captureDir("U5560b")!, baseline ? "base" : "head");
  mkdirSync(dir, { recursive: true });

  const capture = async (name: string) => {
    await lane.browser("screenshot", join(dir, `${name}.png`));
    writeFileSync(join(dir, `${name}.checks.json`), JSON.stringify(await lane.evaluate("window.__checks()")));
  };

  try {
    const origin = await lane.evaluate<string>("location.origin");
    await lane.browser("record", "start", join(dir, "default-width.webm"));

    for (const seed of ["first-run", "tree-40"]) {
      await lane.browser("open", `${origin}/harness.html?seed=${seed}`);
      await lane.until("!!window.__fake && !!document.querySelector('.window')");
      await lane.browser("set", "media", "dark");
      await lane.evaluate("window.dispatchEvent(new Event('open-app-settings'))");
      await lane.until("!!document.querySelector('.settings-view')");
      await capture(`${seed}-before-pads`);

      if (!baseline) await lane.browser("click", '[role=tab][data-value="Pads"]');

      for (const choice of ["narrow", "wide", "full"]) {
        if (!baseline) await lane.browser("click", `.settings-content input[value="${choice}"]`);

        if (!baseline) await lane.until(`document.querySelector('.settings-content input[value="${choice}"]').checked`);

        if (!baseline) await lane.browser("focus", `.settings-content input[value="${choice}"]`);
        await capture(`${seed}-${choice}`);
      }

      await lane.browser("fill", 'input[type="search"]', "Default width");
      await lane.until(baseline ? "!!document.querySelector('.settings-view [role=status]')" : "!!document.querySelector('.settings-result')");
      await capture(`${seed}-search`);

      if (seed === "tree-40") {
        await lane.browser("fill", 'input[type="search"]', "");
        await lane.browser("click", `[role=tab][data-value="${baseline ? "Appearance" : "Pads"}"]`);
        await lane.evaluate(`(() => {
          const original = Storage.prototype.setItem;
          window.__restoreWidthStorage = () => { Storage.prototype.setItem = original; };
          Storage.prototype.setItem = function(key, value) {
            if (key === 'roundup:app-settings') throw new Error('Cannot save settings; free disk space and choose the width again.');
            return original.call(this, key, value);
          };
          return true;
        })()`);
        const choice = baseline ? '.settings-content input[value="small"]' : '.settings-content input[value="narrow"]';
        await lane.browser("click", choice);
        await lane.until("document.querySelector('.settings-view').textContent.includes('Cannot save settings')");
        await capture(`${seed}-save-failure`);
        await lane.evaluate("window.__restoreWidthStorage(); true");
        await lane.browser("click", choice);
        await lane.until("!document.querySelector('.settings-view').textContent.includes('Cannot save settings')");
        await capture(`${seed}-save-recovery`);
      }
    }

    await lane.browser("record", "stop");
  } finally { await lane.close(); }
});
