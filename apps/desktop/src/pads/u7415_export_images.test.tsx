import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { AGENT, openPad, openShelf, padOf } from "./padsFixture";
import { bundledRenderers, useRenderers } from "./visualKinds";

afterEach(() => {
  cleanup();
  useRenderers(bundledRenderers);
});

const diagram = "```mermaid\ngraph TD\n  A-->B\n```";

const drawing = '```excalidraw\n{"type":"excalidraw","version":2,"elements":[]}\n```';

const exportCall = async (text: string, requested: string[] = []) => {
  useRenderers({
    mermaid: async () => {
      requested.push("mermaid");

      return {
        initialize: () => {},
        parse: async (source) => {
          if (source.includes("nonsense")) throw new Error("Parse error");
        },
        render: async () => ({ svg: "<svg>diagram</svg>" }),
      };
    },
    canvas: async () => {
      requested.push("canvas");

      return {
        Excalidraw: () => null,
        convertToExcalidrawElements: () => [],
        restoreElements: () => [],
        exportToSvg: async () => "<svg>drawing</svg>",
      };
    },
  });
  const { app } = await openShelf([padOf("notes", AGENT, text)]);
  app.chooser.savePath = "/d/notes.md";
  app.handlers["pad.export"] = () => null;
  await openPad("notes");
  fireEvent.click(await screen.findByRole("button", { name: "Export .md" }));
  await waitFor(() => expect(app.calls.some((call) => call.method === "pad.export")).toBe(true));

  return app.calls.filter((call) => call.method === "pad.export")[0]?.params;
};

describe("u7415 export images", () => {
  it("u7415a_export_links_each_block_and_writes_its_svg", async () => {
    const params = await exportCall(`${diagram}\n\nprose\n\n${drawing}\n`);

    expect(params).toEqual({
      name: "notes",
      path: "/d/notes.md",
      text: "![Diagram 1](notes/diagram-1.svg)\n\nprose\n\n![Drawing 1](notes/drawing-1.svg)\n",
      images: [
        { name: "diagram-1.svg", svg: "<svg>diagram</svg>" },
        { name: "drawing-1.svg", svg: "<svg>drawing</svg>" },
      ],
    });
  });

  it("u7415a_an_unrenderable_block_stays_fenced_and_is_not_numbered", async () => {
    const bad = "```mermaid\nnonsense\n```";
    const params = await exportCall(`${bad}\n\n${diagram}\n`);

    expect(params).toEqual({
      name: "notes",
      path: "/d/notes.md",
      text: `${bad}\n\n![Diagram 1](notes/diagram-1.svg)\n`,
      images: [{ name: "diagram-1.svg", svg: "<svg>diagram</svg>" }],
    });
  });

  it("u7415b_a_pad_without_blocks_exports_its_text_alone", async () => {
    const requested: string[] = [];
    const params = await exportCall("# Title\n\n```json\n{}\n```\n", requested);

    expect([params, requested]).toEqual([{ name: "notes", path: "/d/notes.md" }, []]);
  });
});
