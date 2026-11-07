import { afterEach, expect, it, vi } from "vitest";
import { tokenColour } from "./tokenColour";

afterEach(() => {
  vi.restoreAllMocks();
  document.documentElement.style.removeProperty("--probe");
});

it("u148_a_display_p3_token_reaches_mermaid_as_srgb", async () => {
  const { mountMermaid } = await import("../pads/mermaidBlock");
  const colours: string[] = [];

  const context = {
    clearRect() {},
    fillRect() {},
    fillStyle: "",
    getImageData: () => ({ data: [180, 180, 180, 255] }),
  };

  // SAFETY: the stub holds the four members `tokenColour` calls on a 2D context.
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context as never);
  // SAFETY: only `getPropertyValue` is read from the style.
  vi.spyOn(window, "getComputedStyle").mockReturnValue({
    getPropertyValue: (name: string) => (name === "--font-ui" ? "Inter" : "color(display-p3 0.706 0.706 0.706)"),
  } as never);
  const host = document.createElement("div");

  // SAFETY: the Pad hands a mount its text; the block reads nothing else.
  mountMermaid({
    initialize: (config) => colours.push(...Object.entries(config.themeVariables).filter(([key]) => key !== "fontFamily").map(([, value]) => value)),
    parse: async () => {},
    render: async () => ({ svg: "<svg></svg>" }),
  })(host, { text: "graph TD\nA-->B" } as never);
  await vi.waitFor(() => expect(colours.length).toBeGreaterThan(0));

  expect(colours.every((colour) => /^(#[0-9a-f]{6}|rgb\()/i.test(colour))).toBe(true);
  expect(tokenColour("--probe")).toBe("rgb(180, 180, 180)");
});
