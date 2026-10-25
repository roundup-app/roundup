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
    await lane.browser("open", `${origin}/harness.html?seed=tree-40&storage-recovery=1`);
    await lane.until("document.querySelector('.storage-failure')?.textContent.includes('Continue without these settings')");
    expect(await lane.calls("agent.start")).toEqual([]);
    await lane.capture("U4086a", "head-invalid-shelf");
    await lane.evaluate("sessionStorage.setItem('u4086:fail', '1')");
    await lane.tabTo("Continue without these settings");
    await lane.browser("press", "Enter");
    await lane.until("document.querySelector('[role=alert]')?.textContent.includes('disk is full')");
    await lane.capture("U4086c", "head-save-failed");
    await lane.evaluate("sessionStorage.removeItem('u4086:fail')");
    await lane.browser("click", ".storage-failure button:last-child");
    await lane.until("document.querySelector('[role=alert]')?.textContent.includes('format is invalid')");
    expect(await lane.evaluate("(async () => (await import('/src/state/storage.ts')).storageRecovery().key)()")).toBe("roundup:rail:/q");
    await lane.capture("U4086d", "head-next-record");
    await lane.browser("click", ".storage-failure button:last-child");
    await lane.until("document.querySelectorAll('.storage-failure button').length === 2 && !!document.querySelector('[role=tree]')");
    await lane.browser("click", ".storage-failure button");
    await lane.until("window.__fake.app.clipboardWrites.length === 1");
    expect(await lane.evaluate<string>("window.__fake.app.clipboardWrites[0]")).toBe(JSON.stringify({ key: "roundup:shelf:/p", bytes: '{"open":' }));
    await lane.capture("U4086b", "head-continued");
    await lane.browser("reload");
    await lane.until("document.querySelectorAll('.storage-failure button').length === 2 && !!document.querySelector('[role=tree]')");
    await lane.browser("focus", ".storage-failure button");
    await lane.browser("press", "Tab");
    await lane.browser("press", "Enter");
    await lane.until("window.__fake.app.clipboardWrites.length === 1");
    const copied = await lane.evaluate<string>("window.__fake.app.clipboardWrites[0]");
    expect(JSON.parse(copied)).toEqual({ key: "roundup:rail:/q", bytes: '{"selected":' });
    expect(await lane.evaluate<string>("document.querySelector('.ask-input').value")).toBe("Original saved work 雪");
    const calls = await lane.calls();
    expect(calls.filter(call => /(?:ask.send|agent.start|terminal.write)/.test(call.method))).toEqual([]);
    await lane.capture("U4086b", "head-reopened-copy");
  } finally { await lane.close(); }
}, 120_000);
