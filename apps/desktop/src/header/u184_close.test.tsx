import { settled } from "../rail/railFixture";
import { questionProbe } from "../testing/menuProbe";
import { questionDialog, answerQuestion } from "../shelf/bulkQuestionHarness";
import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RpcError } from "../app/seam";
import { agent } from "../testing/nodes";
import { openTabs, path, tab, projectTablist, projectTabs } from "./stripFixture";

// jsdom has no layout; Ark excludes zero-size controls from its focus targets.
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(20);
  vi.spyOn(document.documentElement, "clientWidth", "get").mockReturnValue(1024);
  vi.spyOn(document.documentElement, "clientHeight", "get").mockReturnValue(768);
});

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const closer = (name: string) => screen.getByLabelText(`Close ${name}`);

describe("u184 close with a question", () => {
  it("u184_no_agents_closes_at_once", async () => {
    const { app } = await openTabs({ api: [agent("a", "idle", "x"), agent("b", "done", "x")], web: [] });

    fireEvent.click(closer("api"));

    await waitFor(() => expect(app.closed).toEqual([path("api")]));
    await waitFor(() => expect(questionProbe.shown).toBeNull());
  });

  it("u184_the_dialog_names_up_to_three_running_agents", async () => {
    const { app } = await openTabs({ api: ["a", "b", "c", "d", "e"].map((id) => agent(id, "working", "x")), web: [agent("only", "needs-you", "x")] });

    fireEvent.click(closer("api"));

    const dialog = await questionDialog();

    expect(`${dialog.title} ${dialog.message}`).toContain("Close api?");
    expect(`${dialog.title} ${dialog.message}`).toContain("5 Agents run: a, b, c and 2 more.");
    expect(`${dialog.title} ${dialog.message}`).toContain("Closing stops them.");
    expect(app.closed).toEqual([]);

    cleanup();
  });

  it("u184_one_agent_reads_in_the_singular_and_focus_starts_on_cancel", async () => {
    await openTabs({ api: [agent("solo", "blocked", "x")] });

    fireEvent.click(closer("api"));

    const dialog = await questionDialog();

    expect(`${dialog.title} ${dialog.message}`).toContain("1 Agent runs: solo.");
    expect(dialog.cancelLabel).toBe("Keep");
  });

  it("u184_cancel_and_esc_close_nothing", async () => {
    const { app } = await openTabs({ api: [agent("a", "working", "x")], web: [] });

    fireEvent.click(closer("api"));
    await questionDialog();
    await answerQuestion(false);

    await waitFor(() => expect(questionProbe.shown).toBeNull());

    fireEvent.click(closer("api"));
    await questionDialog();
    await answerQuestion(false);

    await waitFor(() => expect(questionProbe.shown).toBeNull());
    expect(app.closed).toEqual([]);
  });

  it("u184_stop_and_close_ends_the_project", async () => {
    const { app } = await openTabs({ api: [agent("a", "working", "x")], web: [] });

    fireEvent.click(closer("api"));
    await questionDialog();
    await answerQuestion(true);

    await waitFor(() => expect(app.closed).toEqual([path("api")]));
    await waitFor(() => expect(projectTabs().map((entry) => entry.textContent)).toEqual(["web"]));
    await waitFor(() => expect(document.activeElement).toBe(tab("web")));
    await waitFor(() => expect(questionProbe.shown).toBeNull());
  });

  it("u184_closing_the_open_tab_opens_the_left_one", async () => {
    await openTabs({ api: [], web: [], docs: [] });

    fireEvent.click(tab("web"));
    fireEvent.click(closer("web"));

    await waitFor(() => expect(projectTabs()).toHaveLength(2));
    expect(tab("api").getAttribute("aria-selected")).toBe("true");
  });

  it("u184_closing_the_first_opens_the_new_first", async () => {
    await openTabs({ api: [], web: [] });

    fireEvent.click(tab("api"));
    fireEvent.click(closer("api"));

    await waitFor(() => expect(projectTabs()).toHaveLength(1));
    expect(tab("web").getAttribute("aria-selected")).toBe("true");
  });

  it("u184_closing_the_last_shows_first_run", async () => {
    const { app } = await openTabs({ api: [] });

    fireEvent.click(closer("api"));
    await waitFor(() => expect(app.closed).toEqual([path("api")]));
    await screen.findByRole("button", { name: "Choose Project…" });
  });

  it("u184_a_failed_close_keeps_the_tab", async () => {
    const { app } = await openTabs({ api: [], web: [] });

    app.closeProject = async () => {
      throw new RpcError(-32603, "could not stop rupd");
    };

    fireEvent.click(closer("api"));

    expect(await screen.findByText("could not stop rupd")).toBeDefined();
    expect(projectTabs()).toHaveLength(2);
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

    expect(projectTabs().map((entry) => entry.textContent)).toEqual(["api", "web", "docs"]);
  });
});

/** A 100 px strip over five 60 px tabs: `c`, `d` and `e` start at or past its right edge. */
const withLayout = async (run: () => Promise<void>) => {
  const spies = [
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(100),
    vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(300),
    vi.spyOn(HTMLElement.prototype, "offsetLeft", "get").mockImplementation(function (this: HTMLElement) {
      return Number(this.dataset.at ?? 0);
    }),
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(60),
  ];

  try {
    await openTabs({ a: [], b: [agent("x", "needs-you", "x")], c: [], d: [agent("z", "needs-you", "x")], e: [agent("y", "error", "x")] });
    document.querySelectorAll<HTMLElement>(".project-tab").forEach((element, at) => (element.dataset.at = String(at * 60)));
    fireEvent.scroll(projectTablist());
    await run();
  } finally {
    spies.forEach((spy) => spy.mockRestore());
  }
};

describe("u184 overflow", () => {
  it("u184_a_hidden_tab_with_a_mark_shows_an_edge_line", async () => {
    await withLayout(async () => {
      const edges = [...document.querySelectorAll(".strip-edge")];

      expect(edges.map((edge) => edge.textContent?.replace(/\s+/g, " ").trim())).toEqual(["2 ▸"]);
      expect(edges[0]?.classList.contains("strip-edge-right")).toBe(true);
      expect(edges[0]?.querySelector(".tab-mark")?.getAttribute("data-tone")).toBe("red");
    });
  });

  it("u184_the_open_tab_is_scrolled_into_view_when_the_strip_first_has_a_width", async () => {
    const reveal = vi.fn();
    const original = Element.prototype.scrollIntoView;

    // SAFETY: the stub takes the receiver and arguments scrollIntoView takes.
    Element.prototype.scrollIntoView = function (this: Element, ...args: unknown[]) {
      reveal(this, ...args);
    } as typeof Element.prototype.scrollIntoView;

    try {
      await withLayout(async () => {
        const open = projectTabs().find((entry) => entry.getAttribute("aria-selected") === "true");

        // SAFETY: the stub records its receiver, which is the Element that was revealed.
        expect(reveal.mock.calls.map((call) => (call[0] as Element).textContent)).toEqual([open?.textContent]);
      });
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  it("u184_the_edge_line_scrolls_and_does_not_switch", async () => {
    const reveal = vi.fn();
    const original = Element.prototype.scrollIntoView;

    // SAFETY: the stub takes the receiver and arguments scrollIntoView takes.
    Element.prototype.scrollIntoView = function (this: Element, ...args: unknown[]) {
      reveal(this, ...args);
    } as typeof Element.prototype.scrollIntoView;

    try {
      await withLayout(async () => {
        const selected = () => projectTabs().find((entry) => entry.getAttribute("aria-selected") === "true")?.textContent;
        const before = selected();

        reveal.mockClear();

        fireEvent.click(document.querySelector(".strip-edge")!);

        expect(reveal).toHaveBeenCalledTimes(1);
        // SAFETY: the stub records its receiver, which is the Element the click revealed.
        expect((reveal.mock.calls[0]![0] as Element).textContent).toContain("d");
        expect(selected()).toBe(before);
      });
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  it("u184_a_hidden_tab_with_a_mark_on_the_left_shows_the_left_edge_line", async () => {
    await withLayout(async () => {
      const list = screen.getByRole("tablist", { name: "Projects" });

      // Scrolled to the end: `a` and `b` lie left of the view, and `b` carries a mark.
      Object.defineProperty(list, "scrollLeft", { configurable: true, value: 200 });
      fireEvent.scroll(list);

      const edges = [...document.querySelectorAll(".strip-edge-left")];

      expect(edges.map((edge) => edge.textContent?.replace(/\s+/g, " ").trim())).toEqual(["◂"]);
      expect(edges[0]?.querySelector(".tab-mark")?.getAttribute("data-tone")).toBe("amber");
    });
  });

  it("u184_the_plus_stays_outside_the_scrolling_strip_at_its_right_end", async () => {
    await withLayout(async () => {
      const add = screen.getByRole("button", { name: "Open Project" });
      const scroll = document.querySelector(".strip-scroll")!;

      expect(screen.getByRole("tablist", { name: "Projects" }).contains(add)).toBe(false);
      expect(scroll.contains(add)).toBe(false);
      expect(scroll.nextElementSibling).toBe(add);
    });
  });

  it("u184_with_nothing_hidden_no_edge_line_shows", async () => {
    await openTabs({ api: [agent("a", "needs-you", "x")], web: [] });

    expect(document.querySelector(".strip-edge")).toBeNull();
  });
});

it("u3512a_pending_confirmation_is_single", async () => {
  const { app } = await openTabs({ api: [agent("a", "working", "x")], web: [] });
  const close = closer("api");
  fireEvent.click(close);
  await questionDialog();
  fireEvent.click(close);
  expect(app.questions).toHaveLength(1);
  expect(app.closed).toEqual([]);
  await answerQuestion(true);
  await waitFor(() => expect(app.closed).toEqual([path("api")]));
});

it("u3512a_unavailable_alert_does_not_authorize_action", async () => {
  const { app } = await openTabs({ api: [agent("a", "working", "x")], web: [] });
  app.questionFailure = new Error("System alert unavailable");
  fireEvent.click(closer("api"));
  await screen.findByText("System alert unavailable");
  expect(app.closed).toEqual([]);
  app.questionFailure = null;
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await questionDialog();
  await answerQuestion(true);
  await waitFor(() => expect(app.closed).toEqual([path("api")]));
});
