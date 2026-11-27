import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { agent, door, event, info, terminal, workstream } from "../testing/nodes";
import { chooseAction, rowOf } from "../rail/railFixture";
import { changed, openTabs, path, tab, treeOf } from "./stripFixture";

afterEach(cleanup);

const markOf = (name: string) => tab(name).querySelector(".tab-mark");

describe("u180 the Tab mark", () => {
  it("u180_error_over_needs_you", async () => {
    await openTabs({ api: [agent("a", "needs-you", "x"), agent("b", "error", "x")], observer: [] });

    expect(markOf("api")?.getAttribute("aria-label")).toBe("Error");
    expect(markOf("api")?.getAttribute("data-tone")).toBe("red");
    expect(markOf("api")?.children.length).toBe(0);
  });

  it("u180_needs_you_alone_is_amber", async () => {
    await openTabs({ api: [agent("a", "needs-you", "x")], observer: [] });

    expect(markOf("api")?.getAttribute("aria-label")).toBe("Needs you");
    expect(markOf("api")?.getAttribute("data-tone")).toBe("amber");
  });

  it("u180_working_blocked_idle_and_done_give_nothing", async () => {
    await openTabs({ api: ([["a0", "working"], ["a1", "blocked"], ["a2", "idle"], ["a3", "done"]] as const).map(([id, kind]) => agent(id, kind, "x")), observer: [] });

    expect(markOf("api")).toBeNull();
  });

  it("u180_a_terminal_gives_nothing_and_a_door_counts", async () => {
    await openTabs({ api: [terminal("t")], web: [door("lead", "needs-you", "x")], observer: [] });

    expect(markOf("api")).toBeNull();
    expect(markOf("web")?.getAttribute("aria-label")).toBe("Needs you");
  });

  it("u180_the_mark_clears_when_the_need_is_answered", async () => {
    const { app } = await openTabs({ api: [agent("a", "needs-you", "x")], web: [], observer: [] });

    treeOf(app, "api", [agent("a", "working", "x")]);
    await changed(app, "api");

    await waitFor(() => expect(markOf("api")).toBeNull());
  });
});

const blocked = { kind: "needs-you", label: "Allow?", since: 5, finished: "0" } as const;

const hover = async (name: string) => {
  fireEvent.pointerEnter(markOf(name)!, { pointerType: "mouse", clientX: 0, clientY: 0 });

  return (await screen.findByRole("tooltip")).textContent;
};

describe("u180 reachable and kept (#7970)", () => {
  const sources: [string, () => Parameters<typeof openTabs>, string][] = [
    ["agent", () => [{ web: [], api: [agent("build", "error", "x")] }], "build errored"],
    ["door", () => [{ web: [], api: [door("lead", "needs-you", "x")] }], "lead needs you"],
    ["workstream", () => [{ web: [], api: [workstream("ws", { attempt: "1", status: blocked })] }], "ws needs you"],
    ["terminal", () => [{ api: [], web: [] }], "dev needs you"],
    ["exit", () => [{ api: [], web: [] }], "daemon exited"],
  ];

  it.each(sources)("u180_each_source_lights_the_mark_names_its_cause_and_a_click_reaches_it: %s", async (source, trees, cause) => {
    const { app } = await openTabs(...trees());

    if (source === "terminal") {
      app.of(path("api")).handlers["terminal.list"] = () => [info("free", { title: "dev", status: blocked })];
      app.of(path("api")).emit(event({ name: "terminal.changed" }));
    }

    if (source === "exit") app.exitDaemon({ code: 3 }, path("api"));

    await waitFor(() => expect(markOf("api")).not.toBeNull());
    expect(await hover("api")).toBe(cause);

    fireEvent.click(markOf("api")!);

    await waitFor(() => expect(tab("api").getAttribute("aria-selected")).toBe("true"));

    if (source === "terminal") await waitFor(() => expect(markOf("api")).toBeNull());
    else if (source === "exit") expect(within(screen.getByRole("region", { name: "Updates" })).getByRole("button", { name: "Reopen" })).toBeDefined();
    else expect(document.querySelector(`[role=treeitem][data-id="${source === "agent" ? "build" : source === "door" ? "lead" : "ws"}"]`)?.getAttribute("aria-selected")).toBe("true");
  });

  it("u180_the_open_projects_tab_keeps_its_mark", async () => {
    await openTabs({ api: [], web: [agent("a", "needs-you", "x")] });

    expect(tab("web").getAttribute("aria-selected")).toBe("true");
    expect(markOf("web")?.getAttribute("aria-label")).toBe("Needs you");
    expect(await hover("web")).toBe("a needs you");
  });

  it("u180_answering_each_source_clears_the_mark", async () => {
    const { app } = await openTabs({ api: [], web: [agent("bad", "error", "x"), agent("ask", "needs-you", "x")] });

    await chooseAction(app, "bad", "Dismiss error");
    await waitFor(() => expect(markOf("web")?.getAttribute("aria-label")).toBe("Needs you"));

    treeOf(app, "web", [agent("ask", "working", "x")]);
    await changed(app, "web");

    await waitFor(() => expect(markOf("web")).toBeNull());
    expect(rowOf("ask")).toBeDefined();
  });

  it("u7189a_the_tab_mark_equals_the_list_for_every_source", async () => {
    const { app } = await openTabs({ api: [agent("quiet", "needs-you", "x", { alert_level: "quiet" }), workstream("fresh", { status: blocked }), agent("pane", "working", "x", { terminal_id: "t-pane" })], web: [] });

    app.of(path("api")).handlers["terminal.list"] = () => [info("t-pane", { owner: "pane", status: blocked })];
    app.of(path("api")).emit(event({ name: "terminal.changed" }));
    await new Promise(resolve => setTimeout(resolve, 50));

    expect(markOf("api")).toBeNull();
  });
});
