import type { AppSeam } from "../app/seam";
import type { ExportImage } from "@contracts/pad/ExportImage";
import { exportDrawing } from "./drawingBlock";
import { renderMermaid } from "./mermaidBlock";
import { currentRenderers } from "./visualKinds";

type Kind = "diagram" | "drawing";

type Fence = { start: number; end: number; kind: Kind; body: string };

const languages = new Map<string, Kind>([["mermaid", "diagram"], ["excalidraw", "drawing"]]);

const OPENING = /^ {0,3}(`{3,}|~{3,})\s*([^\s`]*)[^`]*$/;

/** The top-level fenced blocks of a visual kind, as stored: where each starts and ends in the text, and its body. */
const fences = (text: string) => {
  const found: Fence[] = [];
  const lines = text.split("\n");
  let offset = 0;
  let open: { start: number; marker: string; kind: Kind | undefined; body: string[] } | undefined;

  lines.forEach((line, index) => {
    const next = offset + line.length + 1;

    if (!open) {
      const match = OPENING.exec(line);

      if (match) open = { start: offset, marker: match[1] ?? "```", kind: languages.get((match[2] ?? "").toLowerCase()), body: [] };
    } else if (new RegExp(`^ {0,3}${open.marker[0]}{${open.marker.length},}\\s*$`).test(line.replace(/\r$/, ""))) {
      if (open.kind) found.push({ start: open.start, end: offset + line.length, kind: open.kind, body: open.body.join("\n") });
      open = undefined;
    } else open.body.push(line);

    offset = next;

    if (index === lines.length - 1 && open?.kind) found.push({ start: open.start, end: text.length, kind: open.kind, body: open.body.join("\n") });
  });

  return found;
};

/** U7415a, U7415b: the Pad's text with each renderable diagram and drawing replaced by its image link, and the images; `null` when the Pad has none, so the export writes its stored text alone. */
export const exportWithImages = async (stored: string, folder: string): Promise<{ text: string; images: ExportImage[] } | null> => {
  const blocks = fences(stored);

  if (blocks.length === 0) return null;
  const renderers = currentRenderers();
  const mermaid = blocks.some(block => block.kind === "diagram") ? await renderers.mermaid() : undefined;
  const canvas = blocks.some(block => block.kind === "drawing") ? await renderers.canvas() : undefined;
  const draw = (block: Fence) => (block.kind === "diagram" && mermaid ? renderMermaid(mermaid, block.body) : canvas ? exportDrawing(canvas, block.body) : Promise.reject(new Error(block.kind)));
  const counts = { diagram: 0, drawing: 0 };
  const images: ExportImage[] = [];
  let text = "";
  let at = 0;

  for (const block of blocks) {
    // An invalid block stays fenced, unnumbered, as U148 and U149 show it; the export goes on.
    const [drawn] = await Promise.allSettled([draw(block)]);

    if (drawn.status === "rejected") continue;
    const svg = drawn.value;
    const number = ++counts[block.kind];
    const file = `${block.kind}-${number}.svg`;
    const label = `${block.kind === "diagram" ? "Diagram" : "Drawing"} ${number}`;

    images.push({ name: file, svg });
    text += `${stored.slice(at, block.start)}![${label}](${folder}/${file})`;
    at = block.end;
  }

  return images.length === 0 ? null : { text: text + stored.slice(at), images };
};

/** U21, U7415a: asks for the file, then writes the `.md` and, when the Pad holds a renderable diagram or drawing, the folder of images beside it. */
export const exportPad = async (app: Pick<AppSeam, "chooseSavePath" | "rpc">, name: string) => {
  const path = await app.chooseSavePath([name, ".md"].join(""));

  if (path === null) return;
  const folder = (path.split(/[\\/]/).pop() ?? "").replace(/\.md$/, "");
  const extra = await exportWithImages((await app.rpc("pad.read", { name })).text, encodeURIComponent(folder));

  await app.rpc("pad.export", { name, path, ...extra });
};
