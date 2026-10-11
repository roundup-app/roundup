import { cleanup } from "@solidjs/testing-library";
import { Terminal } from "@xterm/xterm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RpcError } from "../app/seam";
import { door, info, terminal } from "../testing/nodes";
import { findLinks, linkProvider, targetOf } from "./links";
import { mountPane } from "./paneHarness";

afterEach(cleanup);

const texts = (line: string) => findLinks(line).map((found) => found.text);

describe("u365 recognised text", () => {
  it("u365_recognises_links_and_paths", () => {
    expect(texts("see https://example.com, /abs/path/a.ts and src/a.ts:42 or a.rs:1:2")).toEqual([
      "https://example.com", "/abs/path/a.ts", "src/a.ts:42", "a.rs:1:2",
    ]);
    expect(texts("plain words 3.5 and / alone")).toEqual([]);
  });

  it("u365_trailing_punctuation_is_not_part_of_a_link", () => {
    expect(texts("(https://example.com/a.) 'src/a.ts'; \"https://x.io/p\", /tmp/a.ts.")).toEqual([
      "https://example.com/a", "src/a.ts", "https://x.io/p", "/tmp/a.ts",
    ]);
  });
});

describe("u365 targets", () => {
  it("u365_a_relative_path_resolves_against_the_worktree", () => {
    expect(targetOf("src/a.ts:42", "/w/tree")).toEqual({ kind: "path", path: "/w/tree/src/a.ts", line: 42 });
    expect(targetOf("../b/./c.ts", "/w/tree")).toEqual({ kind: "path", path: "/w/b/c.ts", line: null });
    expect(targetOf("/abs/path/a.ts", "/w")).toEqual({ kind: "path", path: "/abs/path/a.ts", line: null });
  });
});

// SAFETY: the link's `activate` reads only `metaKey`, which every call below sets.
const EVENT = (init: Partial<MouseEvent>) => init as MouseEvent;

const printed = async (text: string, cols = 80) => {
  const term = new Terminal({ allowProposedApi: true, cols, rows: 24 });

  await new Promise<void>((resolve) => term.write(text, resolve));

  return term;
};

const linksOn = (term: Terminal, row: number, cmd = true) => {
  const opened: string[] = [];
  let found: import("@xterm/xterm").ILink[] = [];

  linkProvider(() => term.buffer.active, () => cmd, (text) => opened.push(text)).provideLinks(row, (links) => { found = links ?? []; });

  return { opened, found };
};

describe("u365 xterm provider", () => {
  it("u365_cmd_click_opens_once", async () => {
    const { opened, found } = linksOn(await printed("go to https://example.com now"), 1);

    expect(found).toHaveLength(1);
    expect(found[0]!.range).toEqual({ start: { x: 7, y: 1 }, end: { x: 25, y: 1 } });
    found[0]!.activate(EVENT({ metaKey: true }), found[0]!.text);
    expect(opened).toEqual(["https://example.com"]);
  });

  it("u365_a_plain_click_selects_and_opens_nothing", async () => {
    const { opened, found } = linksOn(await printed("https://example.com"), 1, false);

    for (const modifier of [{}, { ctrlKey: true }, { shiftKey: true }, { altKey: true }]) {
      found[0]!.activate(EVENT({ metaKey: false, ...modifier }), found[0]!.text);
    }

    expect(opened).toEqual([]);
  });

  it("u365_cmd_held_underlines_and_shows_a_hand", async () => {
    const term = await printed("https://example.com");
    let cmd = false;
    const provider = linkProvider(() => term.buffer.active, () => cmd, () => {});
    let link!: import("@xterm/xterm").ILink;

    provider.provideLinks(1, (links) => { link = links![0]!; });

    // xterm reads `decorations` on entering the range, then replaces them with its own state behind setters.
    const state = { underline: false, pointerCursor: false };

    link.hover?.(EVENT({}), link.text);
    // SAFETY: the two properties are defined on the next statement, before anything reads them.
    link.decorations = {} as NonNullable<typeof link.decorations>;
    Object.defineProperties(link.decorations, {
      underline: { get: () => state.underline, set: (value: boolean) => { state.underline = value; } },
      pointerCursor: { get: () => state.pointerCursor, set: (value: boolean) => { state.pointerCursor = value; } },
    });

    expect(state).toEqual({ underline: false, pointerCursor: false });
    cmd = true;
    provider.sync();
    expect(state).toEqual({ underline: true, pointerCursor: true });
    cmd = false;
    provider.sync();
    expect(state).toEqual({ underline: false, pointerCursor: false });
    link.leave?.(EVENT({}), link.text);
    cmd = true;
    provider.sync();
    expect(state).toEqual({ underline: false, pointerCursor: false });
  });

  it("u365_wrapped_and_dense_lines_find_each_target", async () => {
    const dense = Array.from({ length: 10 }, (_, index) => `https://e.io/${index} src/f${index}.ts`).join(" ");
    const term = await printed(`${dense}\r\nhttps://example.com/a/very/long/link/that/wraps`, 40);
    const rows = Array.from({ length: term.buffer.active.length }, (_, y) => y + 1);
    const all = new Set<string>();

    for (const row of rows) for (const link of linksOn(term, row).found) all.add(link.text);

    expect(all.size).toBe(21);

    const last = rows.findLast((row) => linksOn(term, row).found.some((link) => link.text.endsWith("/wraps")))!;
    const lower = linksOn(term, last);
    const wrapped = lower.found.find((link) => link.text.endsWith("/wraps"))!;

    expect(wrapped.range.end.y).toBeGreaterThan(wrapped.range.start.y);
    wrapped.activate(EVENT({ metaKey: true }), wrapped.text);
    expect(lower.opened).toEqual(["https://example.com/a/very/long/link/that/wraps"]);
  });
});

describe("u365 opening from a Pane", () => {
  const mount = async () => {
    const worktree = { path: "/p/.roundup/wt-a", branch: "a", base: "main" };

    const mounted = await mountPane(
      [terminal("a", { worktree }), terminal("b"), door("w", "idle", "idle", { terminal_id: "t-w" })],
      [info("t-a"), info("t-b"), info("t-w")],
    );

    return { ...mounted, project: mounted.connected.project.path };
  };

  it("u365_a_web_link_opens_in_the_browser", async () => {
    const { app, connected, emulators } = await mount();

    connected.rail.select("a");
    emulators.get("t-a")!.follow("https://example.com");
    await vi.waitFor(() => expect(app.opens).toEqual([{ kind: "url", url: "https://example.com" }]));
  });

  it("u365_an_absolute_path_opens_with_its_line", async () => {
    const { app, connected, emulators } = await mount();

    connected.rail.select("a");
    emulators.get("t-a")!.follow("/abs/path/a.ts:7");
    await vi.waitFor(() => expect(app.opens).toEqual([{ kind: "path", path: "/abs/path/a.ts", line: 7 }]));
  });

  it("u365_a_relative_path_resolves_against_the_worktree_of_its_agent", async () => {
    const { app, connected, emulators } = await mount();

    connected.rail.select("a");
    emulators.get("t-a")!.follow("src/a.ts:42");
    await vi.waitFor(() => expect(app.opens).toEqual([{ kind: "path", path: "/p/.roundup/wt-a/src/a.ts", line: 42 }]));
  });

  it("u365_without_a_worktree_it_resolves_against_the_project", async () => {
    const { app, connected, emulators, project } = await mount();

    connected.rail.select("b");
    emulators.get("t-b")!.follow("src/a.ts");
    await vi.waitFor(() => expect(app.opens).toEqual([{ kind: "path", path: `${project}/src/a.ts`, line: null }]));
  });

  it("u365_the_door_and_an_agent_share_one_handler", async () => {
    const { app, connected, emulators, project } = await mount();

    connected.rail.select("w");
    emulators.get("t-w")!.follow("src/a.ts:1");
    await vi.waitFor(() => expect(app.opens).toEqual([{ kind: "path", path: `${project}/src/a.ts`, line: 1 }]));
  });

  it("u365_a_missing_path_opens_nothing_and_says_so", async () => {
    const { app, connected, emulators, container } = await mount();

    app.openFailure = new RpcError(-32001, "not found: /p/.roundup/wt-a/nope.ts");
    connected.rail.select("a");
    emulators.get("t-a")!.follow("nope.ts");
    await vi.waitFor(() => expect(container.querySelector(".pane-failure")?.textContent).toContain("/p/.roundup/wt-a/nope.ts does not exist"));
  });
});
