import { Terminal } from "@xterm/xterm";
import type { ILink, ILinkDecorations } from "@xterm/xterm";
import { cleanup } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RpcError } from "../app/seam";
import { door, info, node, terminal } from "../testing/nodes";
import { createLinkProvider, findTargets } from "./links";
import type { LinkTarget } from "./links";
import { mountPane } from "./paneHarness";

afterEach(cleanup);

const targets = (text: string) => findTargets(text).map((match) => match.target);

const printed = async (text: string, cols = 80) => {
  const term = new Terminal({ cols, rows: 10, allowProposedApi: true });

  await new Promise<void>((resolve) => term.write(text, resolve));

  return term;
};

const linksAt = (term: Terminal, y: number, open: (target: LinkTarget) => void, provider = createLinkProvider(term, open)): ILink[] => {
  let found: ILink[] = [];

  provider.provideLinks(y, (links) => {
    found = links ?? [];
  });

  return found;
};

const click = (metaKey: boolean, ctrlKey = false) => new MouseEvent("mouseup", { metaKey, ctrlKey });

describe("u365 links and paths", () => {
  it("u365_recognises_links_and_paths", () => {
    expect(targets("see https://example.com now")).toEqual([{ kind: "url", url: "https://example.com" }]);
    expect(targets("/abs/path/a.ts and src/a.ts:42 and b.ts:3:9 and docs/")).toEqual([
      { kind: "path", path: "/abs/path/a.ts", line: null },
      { kind: "path", path: "src/a.ts", line: 42 },
      { kind: "path", path: "b.ts", line: 3 },
      { kind: "path", path: "docs/", line: null },
    ]);
    expect(targets("plain words only")).toEqual([]);
  });

  it("u365_trailing_punctuation_is_not_part_of_a_link", () => {
    expect(targets('(https://example.com/a), "https://b.dev".')).toEqual([
      { kind: "url", url: "https://example.com/a" },
      { kind: "url", url: "https://b.dev" },
    ]);
    expect(targets("see src/a.ts:42.")).toEqual([{ kind: "path", path: "src/a.ts", line: 42 }]);
  });

  it("u365_cmd_click_opens_once", async () => {
    const open = vi.fn();
    const [link] = linksAt(await printed("go https://example.com\r\n"), 1, open);

    link!.activate(click(true), link!.text);

    expect(link!.text).toBe("https://example.com");
    expect(open.mock.calls).toEqual([[{ kind: "url", url: "https://example.com" }]]);
  });

  it("u365_a_plain_click_selects_and_opens_nothing", async () => {
    const open = vi.fn();
    const [link] = linksAt(await printed("src/a.ts:42\r\n"), 1, open);

    for (const event of [click(false), click(false, true), new MouseEvent("mouseup", { shiftKey: true }), new MouseEvent("mouseup", { altKey: true })]) {
      link!.activate(event, link!.text);
    }

    expect(open).not.toHaveBeenCalled();
  });

  it("u365_the_underline_and_hand_show_only_while_cmd_is_held", async () => {
    const term = await printed("/abs/path/a.ts\r\n");
    const provider = createLinkProvider(term, vi.fn());
    const [link] = linksAt(term, 1, vi.fn(), provider);
    const shown = () => [link!.decorations?.underline, link!.decorations?.pointerCursor];

    expect(shown()).toEqual([false, false]);

    // What xterm's Linkifier does on hover (Linkifier.ts:273-297): assign `{}`, then define setters on what `decorations` returns.
    const state = { underline: Boolean(link!.decorations?.underline), pointerCursor: Boolean(link!.decorations?.pointerCursor) };

    // SAFETY: xterm assigns an empty object, and defines both properties on the next statement before reading any.
    link!.decorations = {} as ILinkDecorations;
    Object.defineProperties(link!.decorations, {
      underline: { get: () => state.underline, set: (value: boolean) => void (state.underline = value) },
      pointerCursor: { get: () => state.pointerCursor, set: (value: boolean) => void (state.pointerCursor = value) },
    });

    provider.setCmd(true);
    expect(state).toEqual({ underline: true, pointerCursor: true });

    provider.setCmd(false);
    expect(state).toEqual({ underline: false, pointerCursor: false });

    provider.setCmd(true);
    expect(shown()).toEqual([true, true]);
  });

  it("u365_wrapped_and_dense_lines_find_each_target", async () => {
    const open = vi.fn();
    const wrapped = await printed("x https://example.com/a/long/path\r\n", 20);
    const rows = [1, 2].map((y) => linksAt(wrapped, y, open));

    expect(rows.map((links) => links.map((link) => link.text))).toEqual([["https://example.com/a/long/path"], ["https://example.com/a/long/path"]]);
    expect(rows[0]![0]!.range).toEqual({ start: { x: 3, y: 1 }, end: { x: 13, y: 2 } });

    const dense = Array.from({ length: 20 }, (_, index) => `src/f${index}.ts`).join(" ");

    expect(findTargets(dense)).toHaveLength(20);

    const densePrinted = await printed(`${dense}\r\n`, 40);
    const found = [1, 2, 3, 4, 5, 6].flatMap((y) => linksAt(densePrinted, y, open).filter((link) => link.range.start.y === y));

    expect(found.map((link) => link.text)).toEqual(Array.from({ length: 20 }, (_, index) => `src/f${index}.ts`));
  });
});

const mountAgent = async (tree = [node("a", { worktree: { path: "/wt/a", branch: "b", base: "main" } })], terminals = [info("t-a")]) => {
  const mounted = await mountPane(tree, terminals);

  mounted.connected.rail.select(tree[0]!.id);
  await Promise.resolve();

  return mounted;
};

const emulatorOf = (mounted: Awaited<ReturnType<typeof mountPane>>, id: string) => mounted.emulators.get(id)!;

describe("u365 opening from a Pane", () => {
  it("u365_a_web_link_opens_in_the_browser", async () => {
    const mounted = await mountAgent();

    emulatorOf(mounted, "t-a").open!({ kind: "url", url: "https://example.com" });
    await Promise.resolve();

    expect(mounted.app.openedTargets).toEqual([{ kind: "url", url: "https://example.com" }]);
  });

  it("u365_an_absolute_path_opens_with_its_line", async () => {
    const mounted = await mountAgent();

    emulatorOf(mounted, "t-a").open!({ kind: "path", path: "/abs/path/a.ts", line: 7 });
    await Promise.resolve();

    expect(mounted.app.openedTargets).toEqual([{ kind: "path", path: "/abs/path/a.ts", line: 7 }]);
  });

  it("u365_a_relative_path_resolves_against_the_worktree", async () => {
    const mounted = await mountAgent();

    emulatorOf(mounted, "t-a").open!({ kind: "path", path: "src/a.ts", line: 42 });
    await Promise.resolve();

    expect(mounted.app.openedTargets).toEqual([{ kind: "path", path: "/wt/a/src/a.ts", line: 42 }]);
  });

  it("u365_without_a_worktree_it_resolves_against_the_project", async () => {
    const mounted = await mountAgent([node("a")]);

    emulatorOf(mounted, "t-a").open!({ kind: "path", path: "src/a.ts", line: null });
    await Promise.resolve();

    expect(mounted.app.openedTargets).toEqual([{ kind: "path", path: "/p/src/a.ts", line: null }]);
  });

  it("u365_the_door_and_an_agent_share_one_handler", async () => {
    const mounted = await mountAgent([door("w", "working", "building", { worktree: { path: "/wt/w", branch: "b", base: "main" } })], [info("t-w")]);

    emulatorOf(mounted, "t-w").open!({ kind: "path", path: "src/a.ts", line: null });
    await Promise.resolve();

    expect(mounted.app.openedTargets).toEqual([{ kind: "path", path: "/p/src/a.ts", line: null }]);
  });

  it("u365_a_missing_path_opens_nothing_and_says_so", async () => {
    const mounted = await mountAgent();

    mounted.app.openFailure = new RpcError(-32001, "/wt/a/gone.ts does not exist");
    emulatorOf(mounted, "t-a").open!({ kind: "path", path: "gone.ts", line: null });
    await vi.waitFor(() => expect(mounted.container.textContent).toContain("/wt/a/gone.ts does not exist"));

    expect(mounted.app.openedTargets).toEqual([]);
  });

  it("u365_other_schemes_open_nothing", async () => {
    const mounted = await mountAgent([terminal("t")], [info("t-t")]);

    mounted.app.openFailure = new RpcError(-32602, "only http and https links open: file:///x");
    emulatorOf(mounted, "t-t").open!({ kind: "url", url: "file:///x" });
    await vi.waitFor(() => expect(mounted.container.textContent).toContain("open failed: only http and https links open"));

    expect(mounted.app.openedTargets).toEqual([]);
  });
});
