import { storageCopy as appStorageCopy } from "../app/copy";
import { expect, it } from "vitest";
import { openLane } from "../todos/laneBrowser";

it("u4086b_continue_quarantines_one_record_and_reopens_with_explicit_copy", async () => {
  const lane = await openLane(1512, "dark", "u4086-recovery");

  try {
    await lane.until("!!window.__fake");
    await lane.capture("U4086a", "base-tree-40");
    const origin = await lane.evaluate<string>("location.origin");
    await lane.evaluate(`(() => {
      localStorage.clear();
      localStorage.setItem('roundup:shelf:/p', '{"open":');
      localStorage.setItem('roundup:rail:/q', '{"selected":');
      localStorage.setItem('roundup:drafts:/Users/you/harness', JSON.stringify({ version: 1, drafts: [{
        revision: 'original-ask-revision', destination: { surface: 'ask', object: 'ask-bar', recipient: null },
        value: { text: 'Original saved work 雪', workstream: null, name: null }, selection: null, status: 'draft', policy: 'ordinary',
      }] }));
    })()`);
    await lane.browser("open", `${origin}/harness.html?view=workstreams&items=1&tabs=1&seed=tree-40&storage-recovery=1`);
    await lane.until("document.querySelector('.storage-gate button:last-child') !== null");
    expect(await lane.calls("agent.spawn")).toEqual([]);
    await lane.capture("U4086a", "head-invalid-shelf");
    await lane.evaluate("sessionStorage.setItem('u4086:fail', '1')");
    await lane.tabTo(appStorageCopy.continue("roundup:shelf:/p"));
    await lane.browser("press", "Enter");
    await lane.until("document.querySelector('[role=alert]')?.textContent.includes('disk is full')");
    await lane.capture("U4086c", "head-save-failed");
    await lane.evaluate("sessionStorage.removeItem('u4086:fail')");
    await lane.browser("click", ".storage-gate button:last-child");
    await lane.until("document.querySelector('[role=alert]')?.textContent.includes('format is invalid')");
    expect(await lane.evaluate("(async () => (await import('/src/state/storage.ts')).storageRecovery().key)()")).toBe("roundup:rail:/q");
    await lane.capture("U4086d", "head-next-record");
    await lane.browser("click", ".storage-gate button:last-child");
    await lane.until("document.querySelectorAll('.storage-retained button').length === 2 && !!document.querySelector('[role=tree]')");
    expect(await lane.evaluate("document.querySelector('.storage-retained [role=alert]') !== null")).toBe(false);
    await lane.browser("click", ".storage-retained button");
    await lane.until("window.__fake.app.clipboardWrites.length === 1");
    expect(await lane.evaluate<string>("window.__fake.app.clipboardWrites[0]")).toBe(JSON.stringify({ key: "roundup:shelf:/p", bytes: '{"open":' }));
    await lane.capture("U4086b", "head-continued");
    await lane.browser("reload");
    await lane.until("document.querySelectorAll('.storage-retained button').length === 2 && !!document.querySelector('[role=tree]')");
    await lane.browser("focus", ".storage-retained button");
    await lane.browser("press", "Tab");
    await lane.browser("press", "Enter");
    await lane.until("window.__fake.app.clipboardWrites.length === 1");
    const copied = await lane.evaluate<string>("window.__fake.app.clipboardWrites[0]");
    expect(JSON.parse(copied)).toEqual({ key: "roundup:rail:/q", bytes: '{"selected":' });
    expect(await lane.evaluate<string>("document.querySelector('.ask-input').value")).toBe("Original saved work 雪");
    const calls = await lane.calls();
    expect(calls.filter(call => /(?:ask.send|agent.spawn|agent.start|agent.resume|agent.restart|workstream.create|terminal.write)/.test(call.method))).toEqual([]);
    await lane.capture("U4086b", "head-reopened-copy");
  } finally { await lane.close(); }
}, 120_000);
