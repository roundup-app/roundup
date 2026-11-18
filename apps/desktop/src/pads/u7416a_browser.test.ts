import { expect, it } from "vitest";
import { browser, read, url, wait } from "../ui/tabsBrowser";

type Element = { type: string; text?: string; x: number; y: number; width: number; height: number };

const flow = "flowchart LR\n  A[Plan] --> B[Build]\n  B --> C[Ship]";

const sequence = "sequenceDiagram\n  Agent->>Daemon: write\n  Daemon->>App: changed";

/** Opens a Pad holding a Mermaid Drawing in the real converter and returns the elements the canvas holds once the user's first gesture stores them. */
const drawn = async (source: string) => {
  await browser("set", "viewport", "1280", "800");
  await browser("open", url("/harness.html?seed=tree-40"));
  await wait("Boolean(document.querySelector('#shelf-tab-pads') && window.__fake)");
  await browser("eval", `window.__fake.app.rpc('pad.write', ${JSON.stringify({ name: "pad-3", text: `\`\`\`excalidraw\n${source}\n\`\`\`\n` })})`);
  await browser("eval", "(() => { const tab = document.querySelector('#shelf-tab-pads'); if (tab.getAttribute('aria-expanded') !== 'true') tab.click(); })()");
  await wait("Boolean(document.querySelector('[data-shelf-row] .pad-name'))");
  await browser("eval", "[...document.querySelectorAll('[data-shelf-row] .pad-name')].find(row => row.textContent === 'pad-3').focus()");
  await browser("press", "Enter");
  await wait("Boolean(document.querySelector('.visual-drawing .excalidraw canvas'))");
  // Loading stores nothing: the Pad still holds the Mermaid source.
  expect(await read<string>("window.__fake.app.rpc('pad.read', { name: 'pad-3' }).then(pad => pad.text)")).toContain(source);
  // The first gesture stores the full scene.
  await browser("click", ".visual-drawing .excalidraw .App-toolbar__extra-tools-trigger");
  await browser("press", "Escape");

  const stored = () => read<string>("window.__fake.app.rpc('pad.read', { name: 'pad-3' }).then(pad => pad.text)");

  await expect.poll(stored, { timeout: 20_000 }).toContain('"type":"excalidraw"');

  const scene = /```excalidraw\n([\s\S]*?)\n```/.exec(await stored());

  // SAFETY: the Pad stored the scene the converter produced, whose elements carry these fields.
  return JSON.parse(scene?.[1] ?? "null").elements as Element[];
};

const apart = (a: Element, b: Element) => a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y;

it("u7416a_a_mermaid_flowchart_block_mounts_labelled_nodes_and_arrows", async () => {
  const elements = await drawn(flow);
  const nodes = elements.filter((element) => element.type === "rectangle");

  expect(nodes).toHaveLength(3);
  expect(elements.filter((element) => element.type === "arrow")).toHaveLength(2);
  expect(elements.flatMap((element) => (element.type === "text" ? [element.text] : [])).sort()).toEqual(["Build", "Plan", "Ship"]);
  expect(nodes.every((node, index) => nodes.slice(index + 1).every((other) => apart(node, other)))).toBe(true);
}, 180_000);

it("u7416a_a_mermaid_sequence_block_mounts_its_participants_and_messages", async () => {
  const elements = await drawn(sequence);
  const texts = elements.flatMap((element) => (element.type === "text" ? [element.text] : []));

  for (const label of ["Agent", "Daemon", "App", "write", "changed"]) expect(texts).toContain(label);
  expect(elements.filter((element) => element.type === "arrow").length).toBeGreaterThanOrEqual(2);
}, 180_000);
