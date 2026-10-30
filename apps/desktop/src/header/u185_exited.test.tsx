import { copy as appCopy } from "../app/copy";
import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { RpcError } from "../app/seam";
import { agent } from "../testing/nodes";
import { openTabs, path, tab } from "./stripFixture";

afterEach(cleanup);

describe("u185 a Daemon gone, in a tab", () => {
  it("u185_a_code_exit_marks_the_tab_error_with_the_code_in_the_tooltip", async () => {
    const { app } = await openTabs({ api: [agent("a", "idle", "x")], web: [] });

    app.exitDaemon({ code: 3 }, path("api"));

    await waitFor(() => expect(tab("api").querySelector(".tab-mark")?.getAttribute("data-kind")).toBe("error"));

    fireEvent.pointerOver(tab("api"), { pointerType: "mouse" });

    expect((await screen.findByRole("tooltip")).textContent).toBe(`api${appCopy.daemonExit("exited 3")}`);
  });

  it("u185_a_signal_exit_reads_by_signal", async () => {
    const { app } = await openTabs({ api: [], web: [] });

    app.exitDaemon({ code: null }, path("api"));
    fireEvent.pointerOver(tab("api"), { pointerType: "mouse" });

    expect((await screen.findByRole("tooltip")).textContent).toBe(`api${appCopy.daemonExit("exited by signal")}`);
  });

  it("u185_the_header_text_shows_for_the_open_project_only", async () => {
    const { app } = await openTabs({ api: [], web: [] });

    app.exitDaemon({ code: 1 }, path("api"));

    await waitFor(() => expect(tab("api").querySelector(".tab-mark")).not.toBeNull());
    expect(within(screen.getByRole("region", { name: "Rail" })).queryByText(appCopy.daemonExit("exited 1"))).toBeNull();

    fireEvent.click(tab("api"));

    expect(await within(screen.getByRole("region", { name: "Rail" })).findByText(appCopy.daemonExit("exited 1"))).toBeDefined();
    expect(within(screen.getByRole("region", { name: "Rail" })).getByRole("button", { name: "Reopen" })).toBeDefined();
  });

  it("u185_another_project_is_unaffected", async () => {
    const { app } = await openTabs({ api: [], web: [agent("w", "needs-you", "x")] });

    app.exitDaemon({ code: 1 }, path("api"));

    await waitFor(() => expect(tab("api").querySelector(".tab-mark")).not.toBeNull());
    expect(tab("web").querySelector(".tab-mark")).toBeNull();
    ;
  });

  it("u185_reopen_calls_open_project_and_clears_the_mark", async () => {
    const { app } = await openTabs({ api: [], web: [] });
    const opened: string[] = [];
    const open = app.openProject;

    app.openProject = (target) => (opened.push(target), open(target));
    fireEvent.click(tab("api"));
    app.exitDaemon({ code: 1 }, path("api"));
    fireEvent.click(await within(screen.getByRole("region", { name: "Rail" })).findByRole("button", { name: "Reopen" }));

    await waitFor(() => expect(tab("api").querySelector(".tab-mark")).toBeNull());
    expect(opened).toEqual([path("api")]);
  });

  it("u185_a_failed_reopen_replaces_the_exit_text_and_offers_reopen_again", async () => {
    const { app } = await openTabs({ api: [], web: [] });

    fireEvent.click(tab("api"));
    app.exitDaemon({ code: 1 }, path("api"));
    app.opened.failure = new RpcError(-32603, "rupd stayed silent");
    fireEvent.click(await within(screen.getByRole("region", { name: "Rail" })).findByRole("button", { name: "Reopen" }));

    expect(await within(screen.getByRole("region", { name: "Rail" })).findByText("rupd stayed silent")).toBeDefined();
    expect(within(screen.getByRole("region", { name: "Rail" })).queryByText(appCopy.daemonExit("exited 1"))).toBeNull();
    expect(within(screen.getByRole("region", { name: "Rail" })).getByRole("button", { name: "Reopen" })).toBeDefined();
  });

  it("u185_closing_an_exited_tab_asks_nothing", async () => {
    const { app } = await openTabs({ api: [agent("a", "working", "x")], web: [] });

    app.exitDaemon({ code: 1 }, path("api"));
    await waitFor(() => expect(tab("api").querySelector(".tab-mark")).not.toBeNull());
    fireEvent.click(screen.getByLabelText("Close api"));

    await waitFor(() => expect(app.closed).toEqual([path("api")]));
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});
