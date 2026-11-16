import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { batch, browser, read, wait } from "../ui/tabsBrowser";
import type { Checks } from "../testing/checks";
import { captureDir } from "../testing/captures";
import { captureSha, headingHitAreas, opened } from "./u5561a_support";

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
      const state = reading?.result.result as { focused: boolean; headings: Record<string, boolean>; agents: boolean; review: boolean };

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
