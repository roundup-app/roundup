import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { batch, browser, read, url, wait } from "../ui/tabsBrowser";
import type { Checks } from "../testing/checks";
import { captureDir } from "../testing/captures";

const captureSha = captureDir("U5704a") ? process.env.ROUNDUP_CAPTURE_SHA ?? execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim() : undefined;

const headingHitAreas = `Array.from(document.querySelectorAll('details[data-pad-heading] summary')).filter(s => s.checkVisibility()).map(s => {
        const r = s.getBoundingClientRect();
        const x = r.left + r.width / 2;
        let hitHeight = 0;
        for (let y = r.top; y < r.bottom; y += 0.25) {
          if (document.elementFromPoint(x, y + 0.125) === s) hitHeight += Math.min(0.25, r.bottom - y);
        }
        return { name: s.ariaLabel, level: s.closest('h1,h2,h3,h4,h5,h6').tagName, expanded: s.getAttribute('aria-expanded'), height: r.height, hitHeight, focused: s.matches(':focus-visible'), hovered: s.matches(':hover') };
      })`;

// One CLI connection for the three setup commands; each still runs in order and a failed one stops the batch.
const opened = (path: string) => browser("batch", "--bail", "set viewport 1512 950", "set media dark", `open '${url(path)}'`);

const focusPad = `(() => { document.querySelector('.pads-tab [data-pad="pad-3"] .pad-name').focus(); return true; })()`;

// Focus the pad-3 row, open it and wait for the page condition in one CLI connection.
const openPad = (until: string) => batch([["eval", focusPad], ["press", "Enter"], ["wait", "--fn", until]]);

const source = "Ready to review.\n\n<details>\n<summary>For Agents</summary>\n\nPath: `日本語/café`\n\n<img src=x onerror=alert(1)>\n<script>alert(1)</script>\n[unsafe](javascript:alert(1))\n\n~~~text\nraw evidence\n~~~\n\n</details>";

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

it.each(["pointer", "Return"].flatMap(input => [false, true].map(present => ({ input, present }))))("u5561b_block_menu_adds_agent_details $input $present", { retry: 0, timeout: 90_000 }, async ({ input, present }) => {
  await opened("/harness.html?seed=tree-40");
  await wait("!!window.__fake && !!document.querySelector('#shelf-tab-pads')");
  const initial = present ? source : "Ready to review.";
  await read(`window.__fake.app.rpc('pad.write', ${JSON.stringify({ name: "pad-3", text: initial })})`);

  if (await read("document.querySelector('#shelf-tab-pads').getAttribute('aria-expanded') !== 'true'")) await browser("click", "#shelf-tab-pads");
  await wait("!!document.querySelector('.pad-name')");
  await openPad("!!document.querySelector('.ProseMirror')");
  // U5631: the Pad-only action must survive a Todo → Pad return.
  await browser("click", ".drawer .close");
  await wait("!document.querySelector('.drawer .ProseMirror')");
  await browser("click", "#shelf-tab-todos");
  await wait("!!document.querySelector('[data-shelf-group=unassigned] [data-part=branch-control]')");

  if (await read("document.querySelector('.todos-tab [data-shelf-group=unassigned]').getAttribute('aria-expanded') === 'false'")) await browser("click", '.todos-tab [data-shelf-group=unassigned] [data-part=branch-control]');
  await wait("!!document.querySelector('.todo-row-button')");
  await browser("focus", ".todo-row-button");
  await browser("press", "Enter");
  await wait("!!document.querySelector('.todo-detail-title')");
  await browser("click", ".drawer .close");
  await wait("!document.querySelector('.drawer .todo-detail-title')");
  await browser("click", "#shelf-tab-pads");
  await wait("!!document.querySelector('.pad-name')");
  await openPad("!!document.querySelector('.ProseMirror')");
  await browser("focus", ".ProseMirror");
  // Insert the menu command before the optional trailing section.
  await browser("press", "Control+Home");
  await browser("press", "End");
  await browser("press", "Enter");
  await browser("keyboard", "type", "/For Agents");
  await wait("!!document.querySelector('.milkdown-slash-menu[data-show=true] li[data-index]')");

  const dir = captureDir("U5561b");

  if (dir) {
    await mkdir(dir, { recursive: true });
    await browser("screenshot", join(dir, `block-menu-${input}-${present}.png`));
    await writeFile(join(dir, `block-menu-${input}-${present}.checks.json`), JSON.stringify(await read("window.__checks()")));
  }

  if (input === "pointer") await browser("click", ".milkdown-slash-menu[data-show=true] li[data-index]");
  else await browser("press", "Enter");
  await wait("document.activeElement?.matches('details[data-pad-agents] textarea')");
  expect(await read("document.querySelectorAll('details[data-pad-agents]').length")).toBe(1);

  if (present) expect(await read("document.querySelector('details[data-pad-agents] textarea').value")).toContain("raw evidence");
  await browser("fill", "details[data-pad-agents] textarea", " Agent evidence saved. ");

  if (dir) {
    await browser("screenshot", join(dir, `menu-${input}-${present}.png`));
    await writeFile(join(dir, `menu-${input}-${present}.checks.json`), JSON.stringify(await read("window.__checks()")));
  }

  await browser("click", ".drawer .close");
  await wait("!document.querySelector('.drawer .ProseMirror')");
  const saved = await read<string>("window.__fake.app.rpc('pad.read', {name:'pad-3'}).then(pad => pad.text)");
  expect(saved).toBe("Ready to review.\n\n<details>\n<summary>For Agents</summary>\n\n Agent evidence saved. \n\n</details>");
  await openPad("!!document.querySelector('details[data-pad-agents]')");
  expect(await read("document.querySelector('details[data-pad-agents]').open")).toBe(false);
  await browser("click", ".drawer .close");
  await wait("!document.querySelector('.drawer .ProseMirror')");
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

it("u5561b_failed_save_keeps_the_edited_agent_details", { retry: 0, timeout: 90_000 }, async () => {
  const failureSource = captureDir("U5704a")
    ? `# ${"A long wrapping heading with review evidence ".repeat(5)}\n\n## Second\n\n### Third\n\n#### Fourth\n\n##### Fifth\n\n###### Sixth\n\n${source}`
    : source;

  await opened("/harness.html?seed=tree-40");
  await wait("!!window.__fake && !!document.querySelector('#shelf-tab-pads')");
  await read(`window.__fake.app.rpc('pad.write', ${JSON.stringify({ name: "pad-3", text: failureSource })})`);

  if (await read("document.querySelector('#shelf-tab-pads').getAttribute('aria-expanded') !== 'true'")) await browser("click", "#shelf-tab-pads");
  await wait("!!document.querySelector('.pad-name')");
  await openPad("!!document.querySelector('details[data-pad-agents]')");
  await browser("click", "details[data-pad-agents] summary");
  await wait("document.querySelector('details[data-pad-agents]').open");
  await read("window.__fake.failNext(-32603, 'Pad not saved: restore write access, then Resume.', 'pad.write')");
  const draft = " Agent evidence after a failed save. ";
  await browser("fill", "details[data-pad-agents] textarea", draft);
  await wait("document.body.innerText.includes('restore write access')");
  expect(await read("document.querySelector('details[data-pad-agents] textarea').value")).toBe(draft);
  expect(await read("window.__fake.app.rpc('pad.read', {name:'pad-3'}).then(pad => pad.text)")).toBe(failureSource);
  const sizingDir = captureDir("U5704a");
  const dir = sizingDir ? join(sizingDir, process.env.ROUNDUP_CAPTURE_PHASE ?? "head") : captureDir("U5561b");

  if (sizingDir) {
    await browser("scroll", "up", "1000", "--selector", ".pad-editor");
    await wait("document.querySelector('.pad-editor').scrollTop === 0");
  }

  if (dir) {
    await mkdir(dir, { recursive: true });
    await browser("screenshot", join(dir, "save-failure.png"));
    await writeFile(join(dir, "save-failure.checks.json"), JSON.stringify({ ...await read<Checks>("window.__checks()"), observation: { sha: captureSha, seed: "tree-40", state: "save-failure", controls: await read(headingHitAreas), viewport: [1512, 950], scheme: "dark" } }));
  }

  await browser("click", ".drawer .close");
  await wait("!document.querySelector('.drawer .ProseMirror')");
  await openPad("!!document.querySelector('details[data-pad-agents]')");
  expect(await read("document.querySelector('details[data-pad-agents] textarea').value")).toBe(draft);
});


it.each([false, true])("u5575a_headings_fold_only_their_sections editable=%s", { retry: 0, timeout: 180_000 }, async (editable) => {
  await opened(`/src/pads/u5561a.html${editable ? "?editable" : ""}`);
  await wait("document.querySelector('#root').dataset.ready === 'true'");
  expect(await read("document.querySelectorAll('details[data-pad-heading]').length")).toBe(8);
  expect(await read("[...document.querySelectorAll('details[data-pad-heading]')].every(d => d.open)")).toBe(true);
  const heading = (name: string) => `details[data-pad-heading] summary[aria-label="${name}"]`;
  const dir = captureDir("U5575a");
  const sizingDir = captureDir("U5704a");

  const captureHeadingTargets = async (name: string, open: boolean) => {
    if (!sizingDir) return;
    const sha = captureSha;

    if (!sha) throw new Error("U5704a requires immutable ROUNDUP_CAPTURE_SHA");
    const folder = join(sizingDir, process.env.ROUNDUP_CAPTURE_PHASE ?? "head");
    await mkdir(folder, { recursive: true });
    const selector = heading(name);

    for (const state of ["rest", "hover", "focus"]) {
      if (state === "rest") {
        await browser("press", "Tab");
        await browser("mouse", "move", "1500", "940");
      } else if (state === "hover") await browser("hover", selector);
      else {
        await browser("mouse", "move", "1500", "940");
        await browser("focus", selector);
        await browser("press", "Enter");
        await wait(`document.querySelector(${JSON.stringify(selector)}).getAttribute('aria-expanded') === '${!open}'`);
        await browser("press", "Enter");
        await wait(`document.querySelector(${JSON.stringify(selector)}).getAttribute('aria-expanded') === '${open}'`);
        await wait(`document.activeElement.matches(${JSON.stringify(selector)})`);
      }

      const controls = await read(headingHitAreas);

      const step = `${editable ? "editor" : "readonly"}-${name}-${open}-${state}`;
      await browser("screenshot", join(folder, `${step}.png`));
      await writeFile(join(folder, `${step}.checks.json`), JSON.stringify({ ...await read<Checks>("window.__checks()"), observation: { sha, seed: "heading-fixture", viewport: [1512, 950], scheme: "dark", name, open, state, controls } }));
    }
  };

  if (dir) await mkdir(dir, { recursive: true });

  const names = ["Verification", "Next step", "Result", "Reference", "Third", "Fourth", "Fifth", "Sixth"];

  for (const input of ["pointer", "Return", "Space"]) {
    for (const name of names.slice(0, input === "pointer" && sizingDir ? names.length : 4)) {
      const selector = heading(name);
      await browser("focus", selector);

      for (const open of [false, true]) {
        // Act, settle and read one editor state per input in one connection, with all queries scoped to that editor.
        const [, , reading] = await batch([
          input === "pointer" ? ["click", selector] : ["press", input === "Return" ? "Enter" : "Space"],
          ["wait", "--fn", `document.querySelector(${JSON.stringify(selector)}).getAttribute('aria-expanded') === '${open}'`],
          ["eval", `(() => {
          const summary = document.querySelector(${JSON.stringify(selector)});
          const editor = summary.closest('.ProseMirror');
          return {
            focused: document.activeElement === summary,
            headings: Object.fromEntries([...editor.querySelectorAll('details[data-pad-heading] summary')].map(s => [s.ariaLabel, s.checkVisibility()])),
            agents: editor.querySelector('details[data-pad-agents]').checkVisibility(),
            review: [...editor.querySelectorAll(':scope > p')].find(p => p.textContent === 'Review.').checkVisibility(),
          };
        })()`],
        ]);

        // SAFETY: the batched eval returns the JSON of the constant expression above.
      const state = reading!.result.result as { focused: boolean; headings: Record<string, boolean>; agents: boolean; review: boolean };

        expect(state.focused).toBe(true);
        expect(state.headings.Reference).toBe(true);

        if (name === "Result") {
          expect(state.headings.Verification).toBe(open);
          expect(state.headings["Next step"]).toBe(open);
        }

        if (name === "Verification") {
          expect(state.agents).toBe(open);
          expect(state.headings["Next step"]).toBe(true);

          if (!open) {
            await browser("press", "Tab");
            expect(await read("document.activeElement.getAttribute('aria-label')")).toBe("Next step");
            await browser("focus", selector);
          }
        }

        if (name === "Next step") expect(state.review).toBe(open);

        if (name === "Reference") expect(state.headings.Third).toBe(open);

        if (input === "pointer") await captureHeadingTargets(name, open);

        if (dir) {
          await browser("screenshot", join(dir, `${name}-${input}-${open}.png`));
          await writeFile(join(dir, `${name}-${input}-${open}.checks.json`), JSON.stringify(await read("window.__checks?.() ?? {}")));
        }
      }
    }
  }

  expect(await read("document.querySelector('#root').dataset.changes")).toBe("0");
  await browser("reload");
  await wait("document.querySelector('#root').dataset.ready === 'true'");
  expect(await read("[...document.querySelectorAll('details[data-pad-heading]')].every(d => d.open)")).toBe(true);
});

it("u5561b_block_menu_inserts_two_labelled_toggles", { retry: 0, timeout: 120_000 }, async () => {
  await browser("eval", "localStorage.clear()");
  await browser("open", url("/harness.html?seed=tree-40"));
  await wait("!!window.__fake && !!document.querySelector('#shelf-tab-pads')");
  await read("window.__fake.app.rpc('pad.write', {name:'pad-3', text:'Between.'})");

  if (await read("document.querySelector('#shelf-tab-pads').getAttribute('aria-expanded') !== 'true'")) await browser("click", "#shelf-tab-pads");
  await wait("!!document.querySelector('.pad-name')");
  await openPad("!!document.querySelector('.ProseMirror')");

  for (const [label, body] of [["Before", "First evidence."], ["After", "Second evidence."]] as const) {
    await browser("click", ".ProseMirror > p:last-child");
    await browser("press", label === "Before" ? "Home" : "End");
    await browser("press", "Enter");

    if (label === "Before") await browser("press", "Control+Home");
    await browser("keyboard", "type", "/Toggle");
    await wait("!!document.querySelector('.milkdown-slash-menu[data-show=true] li[data-index]')");
    await browser("press", "Enter");
    await wait("document.activeElement?.matches('details[data-pad-agents] input')");
    const initialLabel = await read("document.activeElement.closest('details').querySelector('summary').textContent");
    await browser("press", "Control+a");
    await browser("keyboard", "type", label);
    expect(await read("document.activeElement.closest('details').querySelector('summary').textContent")).toBe(initialLabel);
    await browser("press", "Enter");
    const block = `details[data-pad-agents]:has(summary[aria-label="${label}"])`;
    await browser("fill", `${block} textarea`, body);
  }

  await browser("fill", 'details[data-pad-agents]:has(summary[aria-label="After"]) input', "");
  await browser("press", "Enter");
  await wait("!!document.querySelector('summary[aria-label=Toggle]')");
  await browser("click", ".drawer .close");
  await wait("!document.querySelector('.drawer .ProseMirror')");
  const saved = await read<string>("window.__fake.app.rpc('pad.read', {name:'pad-3'}).then(pad => pad.text)");
  expect(saved).toBe("<details>\n<summary>Before</summary>\n\nFirst evidence.\n\n</details>\n\nBetween.\n\n<details>\n<summary>Toggle</summary>\n\nSecond evidence.\n\n</details>");
  await openPad("document.querySelectorAll('details[data-pad-agents]').length === 2");
  expect(await read("[...document.querySelectorAll('details[data-pad-agents]')].every(d => !d.open)")).toBe(true);
});
