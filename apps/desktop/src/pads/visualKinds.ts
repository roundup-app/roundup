import { createElement } from "react";
import type { CanvasApi } from "./drawingBlock";
import { mountDrawing } from "./drawingBlock";
import type { MermaidApi } from "./mermaidBlock";
import { mountMermaid } from "./mermaidBlock";
import type { StatechartApi } from "./statechartBlock";
import { mountStatechart } from "./statechartBlock";
import type { VisualKind, VisualMount } from "./visualBlocks";

/** Where each renderer comes from. A renderer's module is requested when the first block of its kind mounts, never for a Pad without one. */
export type Renderers = {
  mermaid(): Promise<MermaidApi>;
  canvas(): Promise<CanvasApi>;
  statechart(): Promise<StatechartApi>;
};

export const bundledRenderers: Renderers = {
  statechart: async () => {
    const [{ createMachine, createActor }, { default: ELK }] = await Promise.all([import("xstate"), import("elkjs/lib/elk.bundled.js")]);
    const elk = new ELK();

    return {
      createMachine: (config) => {
        // SAFETY: the config is a plain states map with string targets, which `createMachine` accepts.
        const machine = createMachine(config as never);

        return () => createActor(machine);
      },
      layout: async (ids, moves, box) => {
        const graph = await elk.layout({
          id: "root",
          layoutOptions: { "elk.algorithm": "layered", "elk.direction": "DOWN", "elk.edgeRouting": "POLYLINE" },
          children: ids.map((id) => ({ id, ...box })),
          edges: moves.map(([id, from, to]) => ({ id, sources: [from], targets: [to] })),
        });

        const point = (at: { x: number; y: number }) => ({ x: at.x, y: at.y });

        return {
          width: (graph.width ?? 0) + 1,
          height: (graph.height ?? 0) + 1,
          boxes: Object.fromEntries((graph.children ?? []).map((child) => [child.id, { x: child.x ?? 0, y: child.y ?? 0 }])),
          routes: Object.fromEntries(
            (graph.edges ?? []).map((edge) => {
              const section = edge.sections?.[0];

              return [edge.id, section ? [point(section.startPoint), ...(section.bendPoints ?? []).map(point), point(section.endPoint)] : []];
            }),
          ),
        };
      },
    };
  },
  mermaid: async () => {
    const { default: mermaid } = await import("mermaid");

    return {
      initialize: (config) => mermaid.initialize(config),
      parse: async (text) => {
        await mermaid.parse(text);
      },
      render: (id, text) => mermaid.render(id, text),
    };
  },
  canvas: async () => {
    const [module] = await Promise.all([import("@excalidraw/excalidraw"), import("@excalidraw/excalidraw/index.css").then(() => import("./excalidraw.css"))]);

    return {
      // SAFETY: CanvasProps lists the props this Pad passes, each a subset of what Excalidraw accepts and reports.
      Excalidraw: (props) => createElement(module.Excalidraw, props as never),
      // SAFETY: a skeleton is Excalidraw's own input shape, and its output elements all carry `id` and `version`.
      convertToExcalidrawElements: (skeleton, options) => module.convertToExcalidrawElements(skeleton as never, options),
      // SAFETY: stored elements are Excalidraw's own output, and restoring them keeps `id` and `version`.
      restoreElements: (elements) => module.restoreElements(elements as never, null) as never,
      exportToSvg: async (elements) =>
        // SAFETY: the elements are Excalidraw's own output, as in `restoreElements`.
        new XMLSerializer().serializeToString(await module.exportToSvg({ elements: elements as never, appState: { exportBackground: true, viewBackgroundColor: "#ffffff" }, files: null })),
      fromMermaid: async (text) => {
        const { parseMermaidToExcalidraw } = await import("@excalidraw/mermaid-to-excalidraw");
        const { elements } = await parseMermaidToExcalidraw(text);

        // SAFETY: the converter's output is a skeleton, and Excalidraw's own expansion gives it ids and versions.
        return module.convertToExcalidrawElements(elements as never, { regenerateIds: false });
      },
    };
  },
};

const lazy = <Api>(load: () => Promise<Api>, mount: (api: Api) => VisualMount): VisualMount => (host, context) => {
  let release: (() => void) | undefined;
  let live = true;

  void load().then((api) => {
    if (live) release = mount(api)(host, context);
  });

  return () => {
    live = false;
    release?.();
  };
};

let renderers = bundledRenderers;

/** Swaps where the renderers come from; a test passes its own. */
export const useRenderers = (next: Renderers) => {
  renderers = next;
};

/** The empty Drawing the `/` menu inserts. */
export const emptyDrawing = { language: "excalidraw", body: '{"type":"excalidraw","version":2,"elements":[]}' };

/** The renderers in use, for the export of a Pad's blocks. */
export const currentRenderers = () => renderers;

export const visualKinds = () =>
  new Map<string, VisualKind>([
    ["mermaid", { textWhenFocused: true, mount: lazy(renderers.mermaid, mountMermaid) }],
    ["statechart", { textWhenFocused: false, mount: lazy(renderers.statechart, mountStatechart) }],
    ["excalidraw", { textWhenFocused: false, mount: lazy(renderers.canvas, mountDrawing) }],
  ]);
