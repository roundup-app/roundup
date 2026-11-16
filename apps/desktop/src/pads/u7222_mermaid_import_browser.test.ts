import { expect, it } from "vitest";
import { browser, read, url, wait } from "../ui/tabsBrowser";

const drawing = '```excalidraw\n{"type":"excalidraw","version":2,"elements":[]}\n```\n';

type Element = { type: string; text?: string };

it("u7222_a_mermaid_flowchart_imports_into_the_drawing", async () => {
  await browser("set", "viewport", "1512", "950");
  await browser("open", url("/harness.html?seed=tree-40"));
  await wait("Boolean(document.querySelector('#shelf-tab-pads') && window.__fake)");
  await browser("eval", `window.__fake.app.rpc('pad.write', ${JSON.stringify({ name: "pad-3", text: drawing })})`);
  await browser("eval", "(() => { const tab = document.querySelector('#shelf-tab-pads'); if (tab.getAttribute('aria-expanded') !== 'true') tab.click(); })()");
  await wait("Boolean(document.querySelector('[data-shelf-row] .pad-name'))");
  await browser("eval", "[...document.querySelectorAll('[data-shelf-row] .pad-name')].find(row => row.textContent === 'pad-3').focus()");
  await wait("document.activeElement?.matches('.pad-name')");
  await browser("press", "Enter");
  await wait("Boolean(document.querySelector('.visual-drawing .excalidraw'))");
  // Real pointer events: the Drawing saves only a scene the user's own gesture changed.
  await browser("click", ".visual-drawing .App-toolbar__extra-tools-trigger");
  await browser("find", "text", "Mermaid to Excalidraw", "click");
  await browser("fill", ".ttd-dialog-input", "flowchart TD\n A[plan] --> B[ship]");
  // The converter runs on the Mermaid the App installs; a version it cannot read shows the error line, not the preview.
  await wait("Boolean(document.querySelector('.ttd-dialog-output-canvas-container canvas') || document.querySelector('[data-testid=ttd-dialog-output-error]'))");
  expect(await read<boolean>("Boolean(document.querySelector('[data-testid=ttd-dialog-output-error]'))")).toBe(false);
  await browser("find", "role", "button", "click", "--name", "Insert", "--exact");

  const stored = () => read<string>("window.__fake.app.rpc('pad.read', { name: 'pad-3' }).then(pad => pad.text)");

  await expect.poll(stored, { timeout: 20_000 }).toContain('"arrow"');

  const scene = /```excalidraw\n([\s\S]*?)\n```/.exec(await stored());
  const elements: Element[] = JSON.parse(scene?.[1] ?? "null").elements;

  expect(elements.filter((element) => element.type === "rectangle")).toHaveLength(2);
  expect(elements.filter((element) => element.type === "arrow")).toHaveLength(1);
  expect(elements.flatMap((element) => (element.type === "text" ? [element.text] : [])).sort()).toEqual(["plan", "ship"]);
}, 180_000);
