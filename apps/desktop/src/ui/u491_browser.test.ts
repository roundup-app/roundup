import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CHECK_IDS, type Checks } from "../testing/checks";
import { captureDir } from "../testing/captures";
import { expect, it } from "vitest";
import { browser, read, url, wait } from "./tabsBrowser";

const source = new URL("./u491Fixture.tsx", import.meta.url).pathname;

const fixture = source.slice(source.lastIndexOf("/src/")).replace("Fixture.tsx", ".html");

const load = async () => {
  await browser("open", url(fixture));
  await wait(`document.querySelectorAll('.app-splitter').length === 2`);
};

const key = async (name: string, key: string) => {
  await browser("focus", `[aria-label="${name}"]`);
  await browser("press", key);
};

const tabTo = async (selector: string) => {
  for (let step = 0; step < 12; step++) {
    if (await read<boolean>(`document.activeElement?.matches('${selector}')`)) return;
    await browser("press", "Tab");
  }

  expect(await read<boolean>(`document.activeElement?.matches('${selector}')`)).toBe(true);
};

const widths = () => read<{ rail: number; shelf: number }>(`Object.fromEntries(['rail','shelf'].map(name => [name, document.querySelector('[data-layout-panel='+name+']').getBoundingClientRect().width]))`);

it.each([
  ["Resize Rail", [304, 368, 480, 252, 288]],
  ["Resize work items", [304, 240, 560, 240, 320]],
] as const)("u491_keys_limits_and_reset_%s", async (name, expected) => {
  await load();
  const selector = `[aria-label="${name}"]`;
  const keys = ["ArrowRight", "Shift+ArrowRight", "End", "Home", "Enter"];

  for (const [index, input] of keys.entries()) {
    await key(name, input);
    await wait(`document.querySelector('${selector}').getAttribute('aria-valuenow') === '${expected[index]}'`);
    expect(await read<string>(`document.querySelector('[aria-label=Ends]').textContent`)).toBe(String(index + 1));
  }

  expect(await read<unknown>(`(() => {
    const edge = document.querySelector('${selector}');
    return [edge.getAttribute('aria-orientation'), edge.getAttribute('aria-valuemin'), edge.getAttribute('aria-valuemax')];
  })()`)).toEqual(["vertical", name === "Resize Rail" ? "252" : "240", name === "Resize Rail" ? "480" : "560"]);
  await key(name, "Home");
  await wait(`document.querySelector('[aria-label=Ends]').textContent === '6'`);
  await browser("dblclick", selector);
  await wait(`document.querySelector('[aria-label=Ends]').textContent === '7'`);
  expect(await read<string>(`document.querySelector('${selector}').getAttribute('aria-valuenow')`)).toBe(String(expected[4]));
}, 90_000);

it("u491_existing_layout_binding", async () => {
  await browser("set", "viewport", "1280", "800");
  await load();
  expect(await widths()).toEqual({ rail: 288, shelf: 320 });
  await key("Resize Rail", "ArrowRight");
  await wait(`document.querySelector('[data-layout-panel=rail]').getBoundingClientRect().width === 304`);
  expect(await widths()).toEqual({ rail: 304, shelf: 320 });
  await key("Resize work items", "ArrowLeft");
  await wait(`document.querySelector('[data-layout-panel=shelf]').getBoundingClientRect().width === 336`);
  expect(await widths()).toEqual({ rail: 304, shelf: 336 });
  await browser("find", "role", "button", "click", "--name", "Wide", "--exact");
  await wait(`document.querySelector('[data-layout-root]').dataset.shelfMode === 'overlay'`);
  expect(await widths()).toEqual({ rail: 480, shelf: 560 });
  await key("Resize work items", "ArrowRight");
  await wait(`document.querySelector('[data-layout-panel=shelf]').getBoundingClientRect().width === 544`);
  await browser("find", "role", "button", "click", "--name", "Shelf", "--exact");
  await wait(`document.querySelector('[data-layout-panel=shelf]').hidden && !document.querySelector('[aria-label="Resize work items"]')`);
  await key("Resize Rail", "ArrowLeft");
  await wait(`document.querySelector('[data-layout-panel=rail]').getBoundingClientRect().width === 464`);
  expect(await widths()).toEqual({ rail: 464, shelf: 0 });
}, 90_000);


it("u491_controlled_pixels_follow_owner_and_root", async () => {
  await load();
  await read(`window.__providers.widths.rail.commit(352)`);
  await wait(`document.querySelector('[aria-label="Resize Rail"]').getAttribute('aria-valuenow') === '352'`);

  for (const width of [1440, 1280]) {
    await browser("set", "viewport", String(width), "800");
    await wait(`document.querySelector('[data-layout-root]').getBoundingClientRect().width === ${width}`);
    await key("Resize Rail", "ArrowRight");
    await wait(`document.querySelector('[data-layout-panel=rail]').getBoundingClientRect().width === ${width === 1440 ? 368 : 384}`);
  }

  expect(await read<string>(`document.querySelector('[aria-label=Draft]').value`)).toBe("Retained draft");
}, 90_000);

it("u491_drag_preview_end_and_escape", async () => {
  await browser("set", "viewport", "1280", "800");
  await load();
  await read(`(() => {
    const draft = document.querySelector('[aria-label=Draft]');
    draft.value = 'Kept draft';
    draft.setSelectionRange(2, 8);
    document.querySelector('.centre > div').scrollTop = 120;
  })()`);
  await browser("mouse", "move", "286", "200");
  await browser("mouse", "down");
  await browser("mouse", "move", "416", "200");
  await wait(`document.querySelector('[data-layout-panel=rail]').getBoundingClientRect().width > 400`);
  expect(await read<string>(`document.querySelector('[aria-label=Ends]').textContent`)).toBe("0");
  await browser("press", "Escape");
  await wait(`document.querySelector('[data-layout-panel=rail]').getBoundingClientRect().width === 288`);
  await browser("mouse", "up");
  expect(await read<string>(`document.querySelector('[aria-label=Ends]').textContent`)).toBe("0");
  await browser("mouse", "move", "286", "200");
  await browser("mouse", "down");
  await browser("mouse", "move", "900", "200");
  await wait(`document.querySelector('[data-layout-panel=rail]').getBoundingClientRect().width === 480`);
  await browser("mouse", "up");
  await wait(`document.querySelector('[aria-label=Ends]').textContent === '1'`);
  await browser("mouse", "move", "478", "200");
  await browser("mouse", "down");
  await browser("mouse", "move", "0", "200");
  await wait(`document.querySelector('[data-layout-panel=rail]').getBoundingClientRect().width === 252`);
  await browser("mouse", "up");
  await wait(`document.querySelector('[aria-label=Ends]').textContent === '2'`);
  expect(await read<unknown>(`(() => {
    const draft = document.querySelector('[aria-label=Draft]');
    return [draft.value, draft.selectionStart, draft.selectionEnd, document.querySelector('.centre > div').scrollTop];
  })()`)).toEqual(["Kept draft", 2, 8, 120]);
}, 90_000);


for (const scheme of ["light", "dark"]) for (const width of [1280, 1440]) for (const contrast of [process.env.PROVIDERS_CONTRAST === "more"]) {
  it(`u491_rendered_checks u492_rendered_checks ${scheme}-${width}-${contrast}`, async () => {
    const baseline: Record<string, Checks> = {};

    if (captureDir("U491") || captureDir("U492")) expect(process.env.U500_BASE_ROOT).toBeTruthy();

    for (const side of process.env.U500_BASE_ROOT ? ["base", "head"] : ["head"]) {
      await browser("set", "media", scheme);
      await browser("set", "viewport", String(width), "800");
      await browser("open", url(fixture, side === "base"));
      await wait(`document.querySelectorAll('[role=separator]').length === 2`);
      expect(await read<boolean>(`matchMedia("(prefers-contrast: more)").matches`)).toBe(contrast);
      await browser("find", "role", "button", "click", "--name", "Notify", "--exact");
      const card = side === "base" ? ".toast" : ".app-toast-action";

      await wait(`document.querySelector('${card}')`);

      for (const state of ["default", "edge-hover", "edge-focus", "hover", "focus", "dismissed"]) {
        if (state === "edge-hover") await browser("hover", ".resize-edge.rail-edge");

        if (state === "edge-focus") await tabTo(".resize-edge.rail-edge");

        if (state === "hover") await browser("hover", card);

        if (state === "focus") await tabTo(card);

        if (state === "dismissed") {
          await browser("press", "Escape");
          await wait(`!document.querySelector('${card}')`);
        }

        const checks = await read<Checks>(`import('/src/testing/checks.ts').then(m => m.runChecks())`);
        const name = `${scheme}-${width}-${contrast}-${state}`;

        for (const id of ["U491", "U492"]) {
          const art = captureDir(id);

          if (art) {
            const directory = join(art, side);

            mkdirSync(directory, { recursive: true });
            await browser("screenshot", join(directory, `${name}.png`));
            writeFileSync(join(directory, `${name}.checks.json`), JSON.stringify(checks));
          }
        }

        if (side === "base") baseline[state] = checks;
        else for (const id of CHECK_IDS) {
          if (["D2", "D5", "D6"].includes(id) || baseline[state]?.[id].status === "pass") expect(checks[id].status, `${id}: ${JSON.stringify(checks[id])}`).toBe("pass");
        }
      }
    }
  }, 180_000);
}


it.each(["click", "Enter", "Space"])("u492_accessible_activation_%s", async (input) => {
  await load();
  await browser("find", "role", "button", "click", "--name", "Notify", "--exact");
  await wait(`document.querySelector('.app-toast-action')`);
  expect(await read<string>(`document.querySelector('[role=region]').getAttribute('aria-live')`)).toBe("polite");

  if (input === "click") await browser("click", ".app-toast-action");
  else {
    await tabTo(".app-toast-action");
    await browser("press", input);
  }

  await wait(`!document.querySelector('.app-toast')`);
  expect(await read<string>(`document.querySelector('[aria-label=Activations]').textContent`)).toBe("1");
}, 90_000);

it("u492_tab_leaves_toast_for_next_document_control", async () => {
  await load();
  await browser("find", "role", "button", "click", "--name", "Notify", "--exact");
  await wait(`document.querySelector('.app-toast-action')`);
  await browser("focus", ".app-toast-action");
  await browser("press", "Tab");
  expect(await read<string>(`document.activeElement?.getAttribute('aria-label')`)).toBe("Resize work items");
  await browser("press", "Shift+Tab");
  expect(await read<boolean>(`document.activeElement?.matches('.app-toast-action')`)).toBe(true);
}, 90_000);

it("u492_escape_dismisses", async () => {
  await load();
  await browser("find", "role", "button", "click", "--name", "Notify", "--exact");
  await wait(`document.querySelector('.app-toast-action')`);
  await tabTo(".app-toast-action");
  await browser("press", "Escape");
  await wait(`!document.querySelector('.app-toast')`);
  expect(await read<string>(`document.querySelector('[aria-label=Activations]').textContent`)).toBe("0");
}, 90_000);
