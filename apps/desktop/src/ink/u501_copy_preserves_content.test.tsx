import { cleanup, render, screen } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { renderMarkdown } from "../plain/renderMarkdown";
import { cpuText, MISSING, sizeText } from "../resources/format";
import { ErrorLine } from "./ErrorLine";

afterEach(cleanup);

it("u501_copy_preserves_content", () => {
  // A returned error is content: its accessible name is the message byte for byte, its text the first line.
  const returned = "rename failed: «ünï/cødé» → ~/Docs/a b.md\r\nsecond line";
  render(() => <ErrorLine message={returned} />);
  const alert = screen.getByRole("alert");
  expect(alert.getAttribute("aria-label")).toBe(returned);
  expect(alert.textContent).toBe("rename failed: «ünï/cødé» → ~/Docs/a b.md");

  // Markdown keeps authored emphasis, code and paths as written.
  expect(renderMarkdown("**Driftech:** see `story/` and ~/Docs/a b.md")).toBe("<p><strong>Driftech:</strong> see <code>story/</code> and ~/Docs/a b.md</p>");

  // Numeric data stays numeric: the formatter, not the catalogue, decides the digits.
  expect(sizeText(1234567)).toBe("1.2 MB");
  expect(cpuText(37.5)).toBe("38%");
  expect(sizeText(null)).toBe(MISSING);
});
