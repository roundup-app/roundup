import { cleanup } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Terminal } from "@xterm/xterm";
import type { ILink } from "@xterm/xterm";
import { RpcError } from "../app/seam";
import { door, info, node } from "../testing/nodes";
import { createLinkProvider } from "./linkProvider";
import { absolutePath, findTargets } from "./links";
import { mountPane } from "./paneHarness";

afterEach(cleanup);

const printed = (text: string) => findTargets(text).map((found) => text.slice(found.start, found.end));

describe("u365 recognised text", () => {
  it("u365_recognises_links_and_paths", () => {
    expect(findTargets("see https://example.com now")[0]?.printed).toEqual({ kind: "url", url: "https://example.com" });
    expect(findTargets("/abs/path/a.ts")[0]?.printed).toEqual({ kind: "path", path: "/abs/path/a.ts", line: null });
    expect(findTargets("at src/a.ts:42:7")[0]?.printed).toEqual({ kind: "path", path: "src/a.ts", line: 42 });
    expect(findTargets("README.md")[0]?.printed).toEqual({ kind: "path", path: "README.md", line: null });
    expect(printed("hello world 1.5 / done")).toEqual([]);
  });

  it("u365_trailing_punctuation_is_not_part_of_a_link", () => {
    expect(printed("(https://example.com/a).")).toEqual(["https://example.com/a"]);
    expect(printed('"https://example.com", next')).toEqual(["https://example.com"]);
    expect(printed("see src/a.ts:42.")).toEqual(["src/a.ts:42"]);
  });
});

const links = (terminal: Terminal, y: number): Promise<ILink[]> => new Promise((resolve) => {
  const provider = createLinkProvider(terminal, () => kept, (printedTarget) => opened.push(printedTarget));

  provider.provideLinks(y, (found) => resolve(found ?? []));
});

let kept = true;

let opened: unknown[] = [];

const written = async (cols: number, text: string): Promise<Terminal> => {
  const term = new Terminal({ cols, rows: 5, allowProposedApi: true });

  await new Promise<void>((resolve) => term.write(text, resolve));

  return term;
};

const click = (link: ILink, init: MouseEventInit) => link.activate(new MouseEvent("click", init), link.text);

describe("u365 the provider", () => {
  it("u365_cmd_click_opens_once", async () => {
    kept = true;
    opened = [];
    const [link] = await links(await written(80, "go https://example.com ok"), 1);

    click(link!, { metaKey: true });

    expect(opened).toEqual([{ kind: "url", url: "https://example.com" }]);
    expect(link!.range).toEqual({ start: { x: 4, y: 1 }, end: { x: 22, y: 1 } });
  });

  it("u365_a_plain_click_selects_and_opens_nothing", async () => {
    kept = true;
    opened = [];
    const term = await written(80, "https://example.com");
    const [link] = await links(term, 1);

    for (const init of [{}, { ctrlKey: true }, { shiftKey: true }, { altKey: true }]) click(link!, init);

    expect(opened).toEqual([]);
    kept = false;
    expect(await links(term, 1)).toEqual([]);
  });

  it("u365_wrapped_and_dense_lines_find_each_target", async () => {
    kept = true;
    opened = [];
    const dense = Array.from({ length: 20 }, (_, index) => `/p/f${index}.ts`).join(" ");
    const term = await written(60, `${dense}\r\n`);
    const rows = [1, 2, 3, 4].flatMap((y) => [y]);
    const found = (await Promise.all(rows.map((y) => links(term, y)))).flat();
    const texts = new Set(found.map((link) => link.text));

    expect(texts.size).toBe(20);

    const wrapped = found.find((link) => link.range.start.y !== link.range.end.y);

    expect(wrapped).toBeDefined();
    click(wrapped!, { metaKey: true });
    expect(opened).toHaveLength(1);

    const long = await written(20, "https://example.com/a/very/long/link");
    const [whole] = await links(long, 2);

    expect(whole!.text).toBe("https://example.com/a/very/long/link");
    expect(whole!.range.start.y).toBe(1);
    expect(whole!.range.end.y).toBe(2);
  });
});

describe("u365 opening", () => {
  const mount = async (tree = [node("a", { worktree: { path: "/w/a", branch: "b", base: "main" } }), door("d", "working", "x"), node("n")]) => {
    const mounted = await mountPane(tree, [info("t-a"), info("t-d"), info("t-n")]);

    for (const id of ["n", "d", "a"]) {
      mounted.connected.rail.select(id);
      await Promise.resolve();
    }

    return mounted;
  };

  it("u365_a_web_link_opens_in_the_browser", async () => {
    const { app, emulators } = await mount();

    emulators.get("t-a")!.clickLink({ kind: "url", url: "https://example.com" });

    await vi.waitFor(() => expect(app.openedTargets).toEqual([{ kind: "url", url: "https://example.com" }]));
  });

  it("u365_an_absolute_path_opens_with_its_line", async () => {
    const { app, emulators } = await mount();

    emulators.get("t-a")!.clickLink({ kind: "path", path: "/abs/path/a.ts", line: 42 });

    await vi.waitFor(() => expect(app.openedTargets).toEqual([{ kind: "path", path: "/abs/path/a.ts", line: 42 }]));
  });

  it("u365_a_relative_path_resolves_against_the_worktree", async () => {
    const { app, emulators } = await mount();

    emulators.get("t-a")!.clickLink({ kind: "path", path: "src/../src/a.ts", line: 42 });

    await vi.waitFor(() => expect(app.openedTargets).toEqual([{ kind: "path", path: "/w/a/src/a.ts", line: 42 }]));
  });

  it("u365_without_a_worktree_it_resolves_against_the_project", async () => {
    const { app, emulators } = await mount();

    emulators.get("t-n")!.clickLink({ kind: "path", path: "src/a.ts", line: null });

    await vi.waitFor(() => expect(app.openedTargets).toEqual([{ kind: "path", path: "/p/src/a.ts", line: null }]));
  });

  it("u365_the_door_and_an_agent_share_one_handler", async () => {
    const { app, emulators } = await mount();

    emulators.get("t-d")!.clickLink({ kind: "path", path: "a.ts", line: null });
    emulators.get("t-a")!.clickLink({ kind: "path", path: "a.ts", line: null });

    await vi.waitFor(() => expect(app.openedTargets.map((target) => target.kind === "path" && target.path)).toEqual(["/p/a.ts", "/w/a/a.ts"]));
  });

  it("u365_other_schemes_open_nothing", async () => {
    const { app, emulators, container } = await mount();

    app.openFailure = new RpcError(-32002, "only http and https links open: file:///x");
    emulators.get("t-a")!.clickLink({ kind: "url", url: "file:///x" });

    await vi.waitFor(() => expect(container.textContent).toContain("only http and https links open"));
    expect(app.openedTargets).toEqual([]);
  });

  it("u365_a_missing_path_opens_nothing_and_says_so", async () => {
    const { app, emulators, container } = await mount();

    app.openFailure = new RpcError(-32001, "not found: /w/a/gone.ts");
    emulators.get("t-a")!.clickLink({ kind: "path", path: "gone.ts", line: null });

    await vi.waitFor(() => expect(container.querySelector("[role=alert]")?.textContent).toContain("/w/a/gone.ts does not exist"));
    expect(app.openedTargets).toEqual([]);
  });

  it("u365_paths_fold_dots_and_trailing_slashes", () => {
    expect(absolutePath("/a/b/", "/p")).toBe("/a/b");
    expect(absolutePath("../x", "/p/q")).toBe("/p/x");
  });
});
