import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { openLane, type LaneBrowser } from "../todos/laneBrowser";
import { captureDir } from "../testing/captures";

let lane: LaneBrowser;

beforeAll(async () => { lane = await openLane(1512, "dark", "u3787c-import"); }, 180_000);

afterAll(async () => { await lane?.close(); }, 180_000);

it.each(["tree-40", "tabs-8", "conflict"])("u3787c_Import_production_menu_navigation_selection_and_failure_%s", async seed => {
  await lane.seedTodos(["one", "two", "three", "four", "five"], false, seed);
  const dir = captureDir("U3787c");
  const daemon = seed === "tabs-8" ? "window.__fake.app.of('/Users/you/project-number-2')" : "window.__fake.app";

  if (dir) {
    mkdirSync(dir, { recursive: true });
    const url = await lane.evaluate<string>("location.href");

    await lane.browser("record", "start", join(dir, `import-${seed}.webm`), url);
  }

  try {
    await lane.until("!!window.__fake && !!document.querySelector('.rail-row')");
    await lane.browser("set", "viewport", "1512", "950");
    await lane.browser("set", "media", "dark");

    if (seed === "tabs-8") {
      await lane.browser("focus", '.project-tab[data-path="/Users/you/project-number-2"] [role=tab]');
      await lane.browser("press", "Enter");
      await lane.until("!!document.querySelector('.rail-row[data-id=p2-agent]')");
    }

    await lane.evaluate(`(() => {
      const app = ${daemon};
      app.handlers['project.importDiscover'] = () => ({candidates: Array.from({length:8}, (_,at) => ({source:'source-'+at, revision:'revision-'+at, title:at===0?'alpha':at===4?'終 é 🧭':at<3?'同じ é 🧭':'長い名前 é 🧭 '.repeat(8), cwd:'src', last_activity_ms:1n})),excluded:[{source:'excluded',title:'Excluded work',cause:'alreadyImported',reason:'Already imported',last_activity_ms:1n}]});
      app.handlers['project.importCommit'] = () => { throw new Error('Import unavailable. Refresh the saved conversations and retry Import.'); };
      window.dispatchEvent(new CustomEvent('open-project-page', {detail:{path:document.querySelector('.project-tab[data-selected=true]').dataset.path,command:'import-work'}}));
      return true;
    })()`);
    await lane.until("!!document.querySelector('.import-panel')");
    await lane.until("document.querySelectorAll('.import-check input').length === 8");
    await lane.capture("U3787c", `import-${seed}-before`);
    await lane.evaluate(`(() => {
      const boxes = document.querySelectorAll('.import-check input');
      boxes[5].closest('li').hidden=true; boxes[6].disabled=true; boxes[7].closest('li').setAttribute('inert','');
      ${daemon}.calls.length=0;
      return true;
    })()`);
    await lane.browser("focus", '.import-check input');
    await lane.browser("press", "End");
    expect(await lane.evaluate("document.activeElement.dataset.collectionValue")).toBe("source-4");
    await lane.browser("press", "ArrowDown");
    expect(await lane.evaluate("document.activeElement.dataset.collectionValue")).toBe("source-4");
    await lane.browser("press", "Home");
    await lane.browser("press", "終");
    expect(await lane.evaluate("document.activeElement.dataset.collectionValue")).toBe("source-4");
    await lane.browser("press", "Meta+a");
    expect(await lane.evaluate("[...document.querySelectorAll('.import-check input:checked')].map(el=>el.dataset.collectionValue)")).toEqual(["source-0", "source-1", "source-2", "source-3", "source-4"]);
    expect(await lane.evaluate(`${daemon}.calls`)).toEqual([]);
    expect(await lane.evaluate("document.querySelector('.todo-drawer') === null")).toBe(true);
    await lane.browser("fill", ".import-prompt", "  exact é 🧭 instructions  ");
    // Native text selection uses the host browser's chord; the list above owns ⌘A itself.
    await lane.browser("press", process.platform === "darwin" ? "Meta+a" : "Control+a");
    expect(await lane.evaluate("(() => {const field=document.querySelector('.import-prompt');return field.value.slice(field.selectionStart,field.selectionEnd);})()")).toBe("  exact é 🧭 instructions  ");
    expect(await lane.evaluate(`${daemon}.calls`)).toEqual([]);
    await lane.capture("U3787c", `import-${seed}-selected`);
    await lane.browser("click", ".import-confirm");
    await lane.until("document.querySelector('.import-panel [role=alert]')?.textContent.includes('Import unavailable. Refresh the saved conversations and retry Import.')");
    expect(await lane.evaluate(`${daemon}.calls.filter(call=>call.method==='project.importCommit').map(call=>call.params)`)).toEqual([{selections:[0,1,2,3,4].map(at=>({source:`source-${at}`,revision:`revision-${at}`}))}]);
    expect(await lane.evaluate(`${daemon}.calls.filter(call=>call.method==='agent.spawn')`)).toEqual([]);
    await lane.browser("scrollintoview", ".import-panel [role=alert]");
    await lane.capture("U3787c", `import-${seed}-failure`);
  } finally { if (dir) await lane.browser("record", "stop"); }
}, 180_000);
