import { tokenColour, tokenValue } from "../ui/tokenColour";
import { copy } from "./copy";
import type { VisualMount } from "./visualBlocks";

/** The calls the Pad makes of Mermaid. */
export type MermaidApi = {
  initialize(config: { startOnLoad: boolean; securityLevel: "strict"; theme: "base"; themeVariables: Record<string, string | Record<string, string>>; xyChart: { height: number } }): void;
  parse(text: string): Promise<void>;
  render(id: string, text: string): Promise<{ svg: string }>;
};

let counter = 0;

/** U7312c: the five Pad colours, in the order a pie's slices take them. */
const padTones = ["--pad-blue", "--pad-green", "--pad-amber", "--pad-purple", "--red"];

/** The height Mermaid draws a pie at, before CSS shows it at the chart height. */
const MERMAID_PIE_HEIGHT = 450;

/** The error's first line: Mermaid's own message continues with a code frame. */
const firstLine = (error: Error) => error.message.split("\n")[0]?.trim() || copy.invalidDiagram;

const render = async (mermaid: MermaidApi, text: string) => {
  const chartHeight = parseFloat(tokenValue("--pad-chart-height"));
  const grey = tokenColour("--grey");
  const hairline = tokenColour("--hairline");
  // U7312c: a pie's labels show at the small text size once the pie scales to the chart height.
  const pieLabel = `calc(var(--text-small) * ${MERMAID_PIE_HEIGHT / chartHeight})`;

  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: "base",
    themeVariables: {
      background: tokenColour("--ground"),
      primaryColor: tokenColour("--sunken"),
      primaryTextColor: tokenColour("--text"),
      primaryBorderColor: tokenColour("--grey"),
      lineColor: tokenColour("--grey"),
      secondaryColor: tokenColour("--sunken"),
      tertiaryColor: tokenColour("--ground"),
      textColor: tokenColour("--text"),
      fontFamily: tokenValue("--font-ui"),
      // U7312c: pie slices take the five Pad colours, labels are grey and lines are hairlines.
      ...Object.fromEntries(padTones.map((tone, at) => [`pie${at + 1}`, tokenColour(tone)])),
      pieStrokeColor: tokenColour("--ground"),
      pieOuterStrokeColor: hairline,
      pieSectionTextColor: tokenColour("--ground"),
      pieLegendTextColor: grey,
      pieTitleTextColor: tokenColour("--text"),
      pieLegendTextSize: pieLabel,
      pieSectionTextSize: pieLabel,
      xyChart: {
        backgroundColor: tokenColour("--ground"),
        titleColor: tokenColour("--text"),
        plotColorPalette: tokenColour("--pad-blue"),
        xAxisLabelColor: grey,
        yAxisLabelColor: grey,
        xAxisTitleColor: grey,
        yAxisTitleColor: grey,
        xAxisTickColor: hairline,
        yAxisTickColor: hairline,
        xAxisLineColor: hairline,
        yAxisLineColor: hairline,
      },
    },
    // U7312c: an xychart's plot is the chart height Token tall.
    xyChart: { height: chartHeight },
  });
  // `parse` first: a failed `render` leaves its error diagram in the document.
  await mermaid.parse(text);

  return (await mermaid.render(`pad-mermaid-${counter++}`, text)).svg;
};

/** U148: the block as SVG, or its text and one error line. */
export const mountMermaid = (mermaid: MermaidApi): VisualMount => (host, { text }) => {
  let live = true;

  host.classList.add("visual-mermaid");
  void render(mermaid, text).then(
    (svg) => {
      // Mermaid's `strict` level has already sanitized the SVG.
      if (live) host.innerHTML = svg;
    },
    (error: Error) => {
      if (!live) return;
      const source = document.createElement("pre");
      const line = document.createElement("p");

      source.textContent = text;
      line.className = "visual-error";
      line.setAttribute("role", "alert");
      line.textContent = copy.mermaid(firstLine(error));
      host.replaceChildren(source, line);
    },
  );

  return () => {
    live = false;
  };
};
