import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RpcError } from "../app/seam";
import { agent } from "../testing/nodes";
import { openTabs, path, tab } from "./stripFixture";

afterEach(cleanup);

const closer = (name: string) => screen.getByLabelText(`close ${name}`);

describe("u184 close with a question", () => {
  it("u184_no_agents_closes_at_once", async () => {
    const { app } = await openTabs({ api: [agent("a", "idle", "x"), agent("b", "done", "x")], web: [] });

    fireEvent.click(closer("api"));

    await waitFor(() => expect(app.closed).toEqual([path("api")]));
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("u184_the_dialog_names_up_to_three_running_agents", async () => {
    const { app } = await openTabs({ api: ["a", "b", "c", "d", "e"].map((id) => agent(id, "working", "x")), web: [agent("only", "needs-you", "x")] });

    fireEvent.click(closer("api"));

    const dialog = await screen.findByRole("alertdialog");

    expect(dialog.textContent).toContain("Close api?");
    expect(dialog.textContent).toContain("5 Agents run: a, b, c and 2 more.");
    expect(dialog.textContent).toContain("Closing stops them.");
    expect(app.closed).toEqual([]);

    cleanup();
  });

  it("u184_one_agent_reads_in_the_singular_and_focus_starts_on_cancel", async () => {
    await openTabs({ api: [agent("solo", "blocked", "x")] });

    fireEvent.click(closer("api"));

    const dialog = await screen.findByRole("alertdialog");

    expect(dialog.textContent).toContain("1 Agent runs: solo.");
    expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "cancel" }));
  });

  it("u184_cancel_and_esc_close_nothing", async () => {
    const { app } = await openTabs({ api: [agent("a", "working", "x")], web: [] });

    fireEvent.click(closer("api"));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "cancel" }));

    expect(screen.queryByRole("alertdialog")).toBeNull();

    fireEvent.click(closer("api"));
    await screen.findByRole("alertdialog");
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });

    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(app.closed).toEqual([]);
  });

  it("u184_stop_and_close_ends_the_project", async () => {
    const { app } = await openTabs({ api: [agent("a", "working", "x")], web: [] });

    fireEvent.click(closer("api"));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "stop and close" }));

    await waitFor(() => expect(app.closed).toEqual([path("api")]));
    await waitFor(() => expect(screen.getAllByRole("tab").map((entry) => entry.textContent)).toEqual(["web"]));
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("u184_closing_the_open_tab_opens_the_left_one", async () => {
    await openTabs({ api: [], web: [], docs: [] });

    fireEvent.click(tab("web"));
    fireEvent.click(closer("web"));

    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(2));
    expect(tab("api").getAttribute("aria-selected")).toBe("true");
  });

  it("u184_closing_the_first_opens_the_new_first", async () => {
    await openTabs({ api: [], web: [] });

    fireEvent.click(tab("api"));
    fireEvent.click(closer("api"));

    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(1));
    expect(tab("web").getAttribute("aria-selected")).toBe("true");
  });

  it("u184_closing_the_last_shows_first_run", async () => {
    await openTabs({ api: [] });

    fireEvent.click(closer("api"));

    expect(await screen.findByText("open a folder to start")).toBeDefined();
    expect(screen.queryByRole("tab")).toBeNull();
  });

  it("u184_a_failed_close_keeps_the_tab", async () => {
    const { app } = await openTabs({ api: [], web: [] });

    app.closeProject = async () => {
      throw new RpcError(-32603, "could not stop rupd");
    };

    fireEvent.click(closer("api"));

    expect(await screen.findByText("could not stop rupd")).toBeDefined();
    expect(screen.getAllByRole("tab")).toHaveLength(2);
  });

  it("u184_the_close_mark_is_hover_only_and_keeps_its_place", async () => {
    await openTabs({ api: [], web: [] });

    const close = closer("api");

    expect(close.getAttribute("data-visible")).toBe("false");

    fireEvent.pointerEnter(tab("api").parentElement!);

    expect(close.getAttribute("data-visible")).toBe("true");

    fireEvent.pointerLeave(tab("api").parentElement!);

    expect(close.getAttribute("data-visible")).toBe("false");
    expect(close.isConnected).toBe(true);
  });

  it("u184_the_order_never_changes", async () => {
    const { app } = await openTabs({ api: [], web: [agent("w", "error", "x")], docs: [agent("d", "needs-you", "x")] });

    fireEvent.click(tab("docs"));
    await app.renameProject(path("web"), "web2");

    expect(screen.getAllByRole("tab").map((entry) => entry.textContent)).toEqual(["api", "web◉", "docs●"]);
  });
});

describe("u184 overflow", () => {
  it("u184_a_hidden_tab_with_a_mark_shows_an_edge_line", async () => {
    const widths = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(100);

    const offset = vi.spyOn(HTMLElement.prototype, "offsetLeft", "get").mockImplementation(function (this: HTMLElement) {
      return Number(this.dataset.at ?? 0);
    });

    const size = vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(60);

    try {
      await openTabs({ a: [], b: [agent("x", "needs-you", "x")], c: [], d: [], e: [agent("y", "error", "x")] });
      document.querySelectorAll<HTMLElement>(".project-tab").forEach((element, at) => (element.dataset.at = String(at * 60)));
      fireEvent.scroll(screen.getByRole("tablist"));

      const edges = [...document.querySelectorAll(".strip-edge")].map((edge) => edge.textContent);

      expect(edges.length).toBeGreaterThan(0);
      expect(edges.join(" ")).toMatch(/[◂▸]/);
    } finally {
      widths.mockRestore();
      offset.mockRestore();
      size.mockRestore();
    }
  });

  it("u184_with_nothing_hidden_no_edge_line_shows", async () => {
    await openTabs({ api: [agent("a", "needs-you", "x")], web: [] });

    expect(document.querySelector(".strip-edge")).toBeNull();
  });
});
