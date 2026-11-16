import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { batch, browser, read, url, wait } from "../ui/tabsBrowser";
import { captureDir } from "../testing/captures";
import { opened, openPad, source } from "./u5561aBrowser";

it("u5561a_pad_disclosure_toggles_without_writing", { retry: 0, timeout: 90_000 }, async () => {
  await opened("/harness.html?seed=tree-40");
  await wait("!!window.__fake && !!document.querySelector('#shelf-tab-pads')");
  await read(`window.__fake.app.rpc('pad.write', ${JSON.stringify({ name: "pad-3", text: source })})`);

  if (await read("document.querySelector('#shelf-tab-pads').getAttribute('aria-expanded') !== 'true'")) await browser("click", "#shelf-tab-pads");
  await wait("!!document.querySelector('.pad-name')");
  await openPad("!!document.querySelector('details[data-pad-agents] summary')");
  const count = await read<number>("window.__fake.app.calls.filter(call => call.method === 'pad.write').length");
  const section = "details[data-pad-agents]";

  const capture = async (name: string) => {
    const dir = captureDir("U5561a");

    if (!dir) return;
    await mkdir(dir, { recursive: true });
    await browser("screenshot", join(dir, `${name}.png`));
    await writeFile(join(dir, `${name}.checks.json`), JSON.stringify(await read("window.__checks()")));
  };

  expect(await read(`document.querySelector('${section}').open`)).toBe(false);
  expect(await read(`document.querySelector('${section} textarea').checkVisibility({contentVisibilityAuto:true})`)).toBe(false);
  await capture("folded");

  for (const input of ["pointer", "Return", "Space"]) {
    if (input !== "pointer") await browser("focus", `${section} summary`);

    for (const open of [true, false]) {
      // Act, settle and read both observations in one CLI connection.
      const [, , visible, focused] = await batch([
        input === "pointer" ? ["click", `${section} summary`] : ["press", input === "Space" ? "Space" : "Enter"],
        ["wait", "--fn", `document.querySelector('${section}').open === ${open}`],
        ["eval", `document.querySelector('${section} textarea').checkVisibility({contentVisibilityAuto:true})`],
        ["eval", `document.activeElement.matches('${section} summary')`],
      ]);

      expect(visible!.result.result).toBe(open);

      if (input !== "pointer") expect(focused!.result.result).toBe(true);
      await capture(`${input}-${open}`);
    }
  }

  expect(await read(`document.querySelectorAll('${section} img, ${section} script, ${section} a').length`)).toBe(0);
  await browser("click", ".drawer .close");
  await wait("!document.querySelector('.drawer .ProseMirror')");
  expect(await read("window.__fake.app.calls.filter(call => call.method === 'pad.write').length")).toBe(count);
  expect(await read("window.__fake.app.rpc('pad.read', {name:'pad-3'}).then(pad => pad.text)")).toBe(source);
});

it.each([false, true].flatMap(editable => ["Evidence", "For Agents"].map(label => ({ editable, label }))))("u5561a_readonly_pad_disclosure_keeps_unsafe_markup_inert $editable $label", { retry: 0, timeout: 90_000 }, async ({ editable, label }) => {
  await browser("open", url(`/src/pads/u5561a.html?unsafe${editable ? "&editable" : ""}`));
  const name = label === "Evidence" ? "Evidence <img src=x onerror=alert(1)><script>alert(1)</script>[unsafe](javascript:alert(1))" : label;
  await wait("document.querySelector('#root').dataset.ready === 'true'");
  const section = `details[data-pad-agents]:has(> summary[aria-label="${name}"])`;
  const query = JSON.stringify(section);
  expect(await read(`document.querySelector(${query}).open`)).toBe(false);
  expect(await read(`document.querySelector(${query}).querySelector('textarea').readOnly`)).toBe(!editable);

  for (const input of ["pointer", "Return", "Space"]) {
    await browser("focus", `${section} summary`);

    for (const open of [true, false]) {
      const [, , reading] = await batch([
        input === "pointer" ? ["click", `${section} summary`] : ["press", input === "Return" ? "Enter" : "Space"],
        ["wait", "--fn", `document.querySelector(${query}).open === ${open} && document.querySelector(${query}).querySelector('summary').getAttribute('aria-expanded') === '${open}'`],
        ["eval", `(() => {
        const section = document.querySelector(${query});
        const summary = section.querySelector('summary');
        return {
          expanded: summary.getAttribute('aria-expanded'),
          visible: section.querySelector('textarea').checkVisibility(),
          focused: document.activeElement === summary,
          othersClosed: [...section.closest('.ProseMirror').querySelectorAll('details[data-pad-agents]')].filter(d => d !== section).every(d => !d.open),
        };
      })()`],
      ]);

      // SAFETY: the batched eval returns the JSON of the constant expression above.
      const state = reading!.result.result as { expanded: string; visible: boolean; focused: boolean; othersClosed: boolean };

      expect(state.expanded).toBe(String(open));
      expect(state.visible).toBe(open);
      expect(state.focused).toBe(true);
      expect(state.othersClosed).toBe(true);
    }

    await browser("press", "Tab");
    expect(await read(`document.querySelector(${query}).contains(document.activeElement)`)).toBe(false);
  }

  expect(await read("document.querySelectorAll('details img, details script, details a').length")).toBe(0);
  expect(await read("document.querySelector('#root').dataset.changes")).toBe("0");
});
