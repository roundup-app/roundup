import { tokenColour, tokenValue } from "../ui/tokenColour";
import { copy } from "./copy";
import type { VisualMount } from "./visualBlocks";

/** The calls the Pad makes of Mermaid. */
export type MermaidApi = {
  initialize(config: { startOnLoad: boolean; securityLevel: "strict"; theme: "base"; themeVariables: Record<string, string> }): void;
  parse(text: string): Promise<void>;
  render(id: string, text: string): Promise<{ svg: string }>;
};

let counter = 0;

/** The error's first line: Mermaid's own message continues with a code frame. */
const firstLine = (error: Error) => error.message.split("\n")[0]?.trim() || copy.invalidDiagram;

const render = async (mermaid: MermaidApi, text: string) => {
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
    },
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
