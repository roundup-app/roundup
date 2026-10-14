import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromePath, openPage } from "./chromePage";
import type { ChromePage } from "./chromePage";
import { CHECK_IDS } from "./checks";
import type { Checks } from "./checks";
import { captureDir } from "./captures";

const found = chromePath();

const run = found || process.env["CI"] ? describe : describe.skip;

const art = captureDir("U464");

let page: ChromePage;

beforeAll(async () => {
  if (!found) throw new Error("U464 needs a Chrome binary: set CHROME_PATH");
  page = await openPage(found);
}, 90_000);

afterAll(async () => { await page?.close(); });

const load = async (width = 1280) => {
  await page.load("/harness.html?seed=door-stopped", width, 800);
  await page.until(`() => Boolean(window.__fake && document.querySelector('[data-thread-input]'))`);
  await page.call(`() => document.fonts.ready`);
  // The stopped-Door seed has no send handler; model delivery at the existing Daemon seam.
  await page.call(`() => {
    const app = window.__fake.app;
    const messages = [];
    app.handlers['message.list'] = () => messages;
    app.handlers['message.send'] = (params) => {
      const message = {id: messages.length + 1, from: {kind: 'user', id: 'you', parent: null},
        ...params, status: 'delivered', reason: null, passedFrom: null, at: Date.now()};
      messages.push(message);
      app.emit({actor: message.from, name: 'message.delivered', data: message});
      return message;
    };
  }`);
};

const fail = async (action: "start" | "send") => {
  await page.call(`(action) => {
    window.__fake.failNext(-32003, 'U464 call refused');
    if (action === 'start') [...document.querySelectorAll('button')].find(el => el.textContent.includes('Start supervisor')).click();
    else document.querySelector('.thread-send').click();
  }`, action);
  await page.until(`() => document.querySelector('p.ink[role=alert]')?.title === 'U464 call refused'`);
};

const draft = async (value: string) => {
  await page.call(`(value) => {
    const input = document.querySelector('[data-thread-input]');
    input.value = value;
    input.dispatchEvent(new Event('input', {bubbles: true}));
  }`, value);
};

const checks = () => page.call<Checks>(`() => window.__checks()`);

const save = async (name: string) => {
  if (!art) return;
  mkdirSync(art, {recursive: true});
  writeFileSync(join(art, `${name}.png`), Buffer.from(await page.shot(), "base64"));
  writeFileSync(join(art, `${name}.checks.json`), JSON.stringify(await checks(), null, 2));
};

run("u464 failed calls on a stopped Door", () => {
  it("u464_a_failed_start_and_send_are_errors_for_d3", async () => {
    for (const width of [1280, 1440]) {
      for (const action of ["start", "send"] as const) {
        await load(width);
        const baseline = await checks();
        await save(`calm-${width}x800`);

        if (action === "send") await draft("keep this request on failure");
        await fail(action);
        const read = await checks();
        expect(read.D3.status).toBe("pass");
        expect(read.D10.status).toBe("pass");

        for (const id of CHECK_IDS) {
          if (baseline[id].status === "pass") expect(read[id].status, id).toBe("pass");
        }

        expect(await page.call(`() => {
          const el = document.querySelector('p.ink[role=alert]');
          const style = getComputedStyle(el);
          return {kind: el.dataset.kind, title: el.title, text: el.textContent, colour: style.color};
        }`)).toEqual({kind: "error", title: "U464 call refused", text: "U464 call refused", colour: "rgb(196, 38, 46)"});
        await save(`${action}-${width}x800`);
      }
    }
  }, 90_000);

  it("u464_without_an_error_d3_still_rejects_red_amber_and_unrelated_colour", async () => {
    await load();
    await draft("keep this request on failure");
    await fail("send");
    await page.call(`() => {
      const probe = document.createElement('p');
      probe.id = 'colour-probe';
      probe.textContent = 'colour probe';
      probe.style.color = 'rgb(0, 255, 0)';
      document.body.append(probe);
    }`);
    expect((await checks()).D3.status).toBe("fail");
    await page.call(`() => { document.querySelector('#colour-probe').remove(); document.querySelector('.thread-send').click(); }`);
    await page.until(`() => !document.querySelector('p.ink[role=alert]') && document.querySelector('[data-thread-input]').value === ''`);
    expect((await checks()).D3.status).toBe("pass");
    expect(await page.call(`() => Boolean(document.querySelector('[data-kind=error], [data-kind=needs-you]'))`)).toBe(false);

    for (const colour of ["var(--red)", "var(--amber)", "rgb(0, 255, 0)"]) {
      await page.call(`(colour) => {
        const probe = document.createElement('p');
        probe.id = 'colour-probe';
        probe.textContent = 'colour probe';
        probe.style.color = colour;
        document.body.append(probe);
      }`, colour);
      expect((await checks()).D3.status, colour).toBe("fail");
      await page.call(`() => document.querySelector('#colour-probe').remove()`);
    }
  }, 30_000);

  it("u464_a_rejected_send_keeps_the_draft_and_retry_delivers_it_once", async () => {
    await load();
    const input = "keep this request on failure\n  exact spacing and emoji 🧭";
    await draft(input);
    await fail("send");
    expect(await page.call(`() => document.querySelector('[data-thread-input]').value`)).toBe(input);
    expect(await page.call(`async () => (await window.__fake.app.rpc('message.list', {to: null, status: null})).filter(each => each.body.includes('keep this request on failure')).length`)).toBe(0);
    await page.call(`() => document.querySelector('.thread-send').click()`);
    await page.until(`() => !document.querySelector('p.ink[role=alert]') && document.querySelector('[data-thread-input]').value === ''`);
    expect(await page.call(`async () => (await window.__fake.app.rpc('message.list', {to: null, status: null})).filter(each => each.body.includes('keep this request on failure')).map(each => ({body: each.body, status: each.status}))`)).toEqual([{body: input, status: "delivered"}]);
    await save("retry-1280x800");
  }, 30_000);

});
