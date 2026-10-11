import { cleanup, render, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { asking, card, mountApp, select } from "../decisions/decisionsFixture";
import { DigestCard } from "../digest/DigestCard";
import { agent, door, USER } from "../testing/nodes";
import { message, mountThread } from "../thread/threadFixture";
import { Markdown } from "./Markdown";
import { renderMarkdown } from "./renderMarkdown";

const BODY = [
  '1. **Driftech:** fill in "What they do" and the gap in the follow-up, ...',
  "2. **A new opportunity:** tell me the company and the founder.",
  "3. **Communicate:** a bio, an intro template, or a post, saved in `story/`.",
].join("\n");

const DOOR = { kind: "agent", id: "r1", parent: null } as const;

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
  it("q10_markdown_becomes_elements", async () => {
    await mountThread([door("r1", "idle", "idle", { name: "one" }), agent("a1", "working", "x", { parent: "r1", name: "ann" })], {
      messages: [message(1, { from: DOOR, to: "you", kind: "question", body: BODY })],
    });
    await waitFor(() => expect(document.querySelector("[data-message-card] .thread-card-body")).not.toBeNull());
    expectRendered(document.querySelector("[data-message-card] .thread-card-body")!);

    cleanup();
    await mountApp([asking("d1", "a", BODY, ["ok"])]);
    select("alpha");
    await waitFor(() => expect(card()).not.toBeNull());
    expectRendered(card()!.querySelector(".decision-question")!);
  });

  it("q10_all_elements", () => {
    const { container } = render(() => <Markdown body={"*a* **b** [l](https://x.test)\n\n- u\n\n| h | i |\n|---|---|\n| 1 | 2 |\n\n```\nfence\n```"} />);

    for (const tag of ["em", "strong", "a[href]", "ul", "table", "pre", "code"]) expect(container.querySelector(tag), tag).not.toBeNull();
  });

  it("q10_body_is_ui_and_code_is_mono", () => {
    const { container } = render(() => <Markdown body={BODY + "\n\n```\nx\n```"} />);
    const body = container.querySelector(".markdown")!;

    expect(getComputedStyle(body).fontFamily).toBe("var(--font-ui)");
    expect(getComputedStyle(body).textAlign).toBe("left");
    expect(getComputedStyle(body.querySelector("code")!).fontFamily).toBe("var(--font-mono)");
    expect(getComputedStyle(body.querySelector("pre")!).fontFamily).toBe("var(--font-mono)");
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
    const { container } = render(() => <DigestCard entry={{ name: "a", kind: "idle", last: BODY, todos: 0, pads: [] }} />);

    expect(container.querySelector(".digest-last")!.innerHTML).toBe(html);
    expect(html).toBe(renderMarkdown(BODY).replace(/&quot;/g, '"'));
  });

  it("q10_typed_text_is_not_rendered", async () => {
    await mountThread([door("r1", "idle", "idle", { name: "one" })], {
      messages: [message(1, { from: USER, to: "r1", kind: "note", body: "a **x**\nb" })],
    });
    await waitFor(() => expect(document.querySelector("[data-message-body]")).not.toBeNull());

    const body = document.querySelector("[data-message-body]")!;

    expect(body.textContent).toContain("**x**");
    expect(body.querySelector("strong")).toBeNull();
    expect(getComputedStyle(body).whiteSpace).toBe("pre-wrap");
  });
});
