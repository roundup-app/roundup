import { cleanup, render } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { Markdown } from "./Markdown";
import { renderMarkdown } from "./renderMarkdown";

const BODY = [
  '1. **Driftech:** fill in "What they do" and the gap in the follow-up, ...',
  "2. **A new opportunity:** tell me the company and the founder.",
  "3. **Communicate:** a bio, an intro template, or a post, saved in `story/`.",
].join("\n");

const textNodes = (root: Element) => {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const found: string[] = [];

  for (let node = walker.nextNode(); node; node = walker.nextNode()) found.push(node.textContent ?? "");

  return found;
};

const expectRendered = (root: Element) => {
  expect(root.querySelector("strong")).not.toBeNull();
  expect(root.querySelector("code")).not.toBeNull();
  expect(root.querySelectorAll("ol > li")).toHaveLength(3);

  for (const text of textNodes(root)) {
    expect(text).not.toContain("**");
    expect(text).not.toContain("`");
    expect(text).not.toMatch(/^\s*1\. /);
  }
};

afterEach(cleanup);

describe("Q10 the App renders the Markdown an Agent writes", () => {
  it("q10_markdown_becomes_elements", () => {
    const { container } = render(() => <Markdown body={BODY} />);

    expectRendered(container);
  });

  it("q10_all_elements", () => {
    const { container } = render(() => <Markdown body={"*a* **b** [l](https://x.test)\n\n- u\n\n| h | i |\n|---|---|\n| 1 | 2 |\n\n```\nfence\n```"} />);

    for (const tag of ["em", "strong", "a[href]", "ul", "table", "pre", "code"]) expect(container.querySelector(tag), tag).not.toBeNull();
  });

  it("q10_html_is_text", () => {
    const { container } = render(() => <Markdown body={"<img src=x onerror=alert(1)>\n\n[go](javascript:alert(1)) ![pic](x.png)"} />);

    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("[onerror]")).toBeNull();
    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toContain("<img src=x onerror=alert(1)>");
    expect(container.textContent).toContain("go");
  });

  it("q10_one_renderer", () => {
    const html = render(() => <Markdown body={BODY} />).container.querySelector(".markdown")!.innerHTML;
    expect(html).toBe(renderMarkdown(BODY).replace(/&quot;/g, '"'));
  });
});
