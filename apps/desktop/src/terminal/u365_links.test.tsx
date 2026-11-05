import { cleanup } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Terminal } from "@xterm/xterm";
import type { ILink } from "@xterm/xterm";
import { RpcError } from "../app/seam";
import type { OpenTarget } from "../app/seam";
import { door, info, node } from "../testing/nodes";
import { createLinkProvider } from "./linkProvider";
import { absolutePath, findTargets, openPrinted } from "./links";
import { mountPane } from "./paneHarness";

afterEach(cleanup);

const printed = (text: string) => findTargets(text).map((found) => text.slice(found.start, found.end));

describe("u365 recognised text", () => {
  it("u365_recognises_links_and_paths", () => {
    expect(findTargets("see https://example.com now")[0]?.printed).toEqual({ kind: "url", url: "https://example.com" });
    expect(findTargets("/abs/path/a.ts")[0]?.printed).toEqual({ kind: "path", path: "/abs/path/a.ts", line: null });
    expect(findTargets("at src/a.ts:42:7")[0]?.printed).toEqual({ kind: "path", path: "src/a.ts", line: 42 });
    expect(findTargets("README.md")[0]?.printed).toEqual({ kind: "path", path: "README.md", line: null });

    for (const path of ["/tmp/moo-identity/taste/heading-logo-board.png", "/abs/folder", "/abs/folder/", "/tmp/", "./LICENSE", "/a.c", "/a.Z9", "/.env"]) {
      expect(findTargets(path)[0]?.printed).toEqual({ kind: "path", path, line: null });
    }

    for (const token of ["hello", "1.5", "/", "/clear", "/context", "/hope:compose", "/word", "/word:word", "/LICENSE", "/tmp", "(/clear).", "/root.ts:word", "/word:42", "/word:42:7", "/word.1", "/word.é", "/word.a_b", "/word.a-b"]) {
      expect(printed(token), token).toEqual([]);
    }

    for (const token of ["(/root.ts:42:7).", "'/root.ts:42',"]) {
      expect(findTargets(token)[0]?.printed).toEqual({ kind: "path", path: "/root.ts", line: 42 });
    }
  });

  it("u365_trailing_punctuation_is_not_part_of_a_link", () => {
    expect(printed("(https://example.com/a).")).toEqual(["https://example.com/a"]);
    expect(printed('"https://example.com", next')).toEqual(["https://example.com"]);
    expect(printed("see src/a.ts:42.")).toEqual(["src/a.ts:42"]);
  });
});

const links = (terminal: Terminal, y: number): Promise<ILink[]> => new Promise((resolve) => {
  const provider = createLinkProvider(terminal, (printedTarget) => opened.push(printedTarget));

  provider.provideLinks(y, (found) => resolve(found ?? []));
});

let opened: unknown[] = [];

const written = async (cols: number, text: string): Promise<Terminal> => {
  const term = new Terminal({ cols, rows: 5, allowProposedApi: true });

  await new Promise<void>((resolve) => term.write(text, resolve));

  return term;
};

const click = (link: ILink, init: MouseEventInit) => link.activate(new MouseEvent("click", init), link.text);

describe("u365 the provider", () => {
  it("u365_plain_click_opens_once", async () => {
    opened = [];
    const [link] = await links(await written(80, "go https://example.com ok"), 1);

    click(link!, {});

    expect(opened).toEqual([{ kind: "url", url: "https://example.com" }]);
    expect(link!.range).toEqual({ start: { x: 4, y: 1 }, end: { x: 22, y: 1 } });
  });

  it("u365_wrapped_and_dense_lines_find_each_target", async () => {
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
    expect(absolutePath("./LICENSE", "/")).toBe("/LICENSE");
  });
});

describe("u365b bare domains", () => {
  const target = (text: string) => findTargets(text)[0]?.printed;

  it("u365b_a_bare_domain_is_a_link", () => {
    for (const [text, path] of [
      ["legislation.gov.uk", "legislation.gov.uk"],
      ["www.example.com/a", "www.example.com/a"],
      ["example.co.uk/x?y=1", "example.co.uk/x?y=1"],
      ["example.com?y=1.", "example.com?y=1"],
      ["(example.org#top)", "example.org#top"],
    ] as const) {
      expect(target(text), text).toEqual({ kind: "path", path, line: null });
    }

    expect(printed("example.com?y=1")).toEqual(["example.com?y=1"]);
  });

  it("u365b_a_non_suffix_token_stays_plain_text", () => {
    for (const token of ["foo.notatld?x=1", "a.b#c", "v1.2", "a@b.co", "mailto:a@b.co", "example.com:80?x"]) {
      expect(printed(token), token).toEqual([]);
    }

    expect(target("file.txt")).toEqual({ kind: "path", path: "file.txt", line: null });
  });

  const open = (failures: Record<string, RpcError>) => {
    const calls: OpenTarget[] = [];

    const openTarget = async (t: OpenTarget) => {
      calls.push(t);

      const failure = failures[t.kind === "url" ? t.url : t.path];

      if (failure) throw failure;
    };

    return { calls, run: (text: string) => openPrinted(openTarget, target(text)!, "/p", (path) => `${path} does not exist.`) };
  };

  it("u365b_an_existing_file_named_like_a_domain_opens_the_file", async () => {
    const { calls, run } = open({});

    expect(await run("notes.io")).toBeNull();
    expect(calls).toEqual([{ kind: "path", path: "/p/notes.io", line: null }]);
  });

  it("u365b_a_missing_file_falls_back_to_https", async () => {
    const { calls, run } = open({ "/p/legislation.gov.uk": new RpcError(-32001, "not found") });

    expect(await run("legislation.gov.uk")).toBeNull();
    expect(calls).toEqual([{ kind: "path", path: "/p/legislation.gov.uk", line: null }, { kind: "url", url: "https://legislation.gov.uk" }]);
  });

  it("u365b_a_refused_fallback_shows_its_cause", async () => {
    const { run } = open({ "/p/a.gov.uk": new RpcError(-32001, "not found"), "https://a.gov.uk": new RpcError(-32002, "only http and https links open") });

    expect(await run("a.gov.uk")).toBe("only http and https links open");
  });

  it("u365b_every_link_form_maps_to_its_target", async () => {
    const rows: [string, unknown][] = [
      ["https://example.com/a", { kind: "url", url: "https://example.com/a" }],
      ["/abs/a.ts", { kind: "path", path: "/abs/a.ts", line: null }],
      ["src/a.ts", { kind: "path", path: "/p/src/a.ts", line: null }],
      ["README.md", { kind: "path", path: "/p/README.md", line: null }],
      ["~/notes/a.md", { kind: "path", path: "~/notes/a.md", line: null }],
      ["~/", { kind: "path", path: "~/", line: null }],
      ["src/a.ts:42", { kind: "path", path: "/p/src/a.ts", line: 42 }],
      ["src/a.ts:42:7", { kind: "path", path: "/p/src/a.ts", line: 42 }],
    ];

    for (const [text, expected] of rows) {
      const { calls, run } = open({});

      await run(text);
      expect(calls, text).toEqual([expected]);
    }

    for (const none of ["mailto:a@b.co", "a@b.co"]) expect(printed(none), none).toEqual([]);
  });

  it("u365b_osc8_http_opens_through_open_target", async () => {
    const { app, emulators } = await mountPane([node("n")], [info("t-n")]).then(async (mounted) => {
      mounted.connected.rail.select("n");
      await Promise.resolve();

      return mounted;
    });

    emulators.get("t-n")!.clickLink({ kind: "url", url: "https://example.com/osc" });

    await vi.waitFor(() => expect(app.openedTargets).toEqual([{ kind: "url", url: "https://example.com/osc" }]));
  });
});
