import { fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { describe, expect, it } from "vitest";
import { mountApp, select } from "../decisions/decisionsFixture";
import type { Kind } from "@contracts/Kind";
import type { Order } from "@contracts/agent/Order";
import { agent, clarifying, door } from "../testing/nodes";

const limits = ["Change no file", "Keep it short", "Ask before deleting", "Use no network"];

const prompt = `## Details\n\n${"Walk through each part of the screenshot. ".repeat(60)}\n\n- **bold** item`;

const KINDS: Kind[] = ["error", "needs-you", "blocked", "working", "idle", "done"];

export const openDrawer = async (
  order: Order,
  options: { kind?: Kind; handlers?: Record<string, (params: never) => object | null> } = {},
) => {
  await mountApp([], (app) => {
    app.handlers["rail.tree"] = () => [
      agent("a", options.kind ?? "working", "editing", { name: "alpha", order: 0, work: order }),
      agent("b", "working", "editing", { name: "beta", order: 1, work: clarifying("which?") }),
      door("r", "working", "editing", { name: "harbor", order: 2, work: clarifying("why?") }),
    ];
    app.handlers["agent.spawnPrompt"] = () => ({ prompt });
    Object.assign(app.handlers, options.handlers ?? {});
  });
  select("alpha");
  await waitFor(() => expect(document.querySelector(".order-line")).not.toBeNull());
  fireEvent.click(document.querySelector(".order-line")!);

  return await screen.findByLabelText("Full order of alpha");
};

const full: Order = {
  kind: "work",
  title: "Give a Drawer tour",
  ask: "Give a tour of the Drawer",
  done: "The tour is written",
  limits,
};

describe("O15: the Drawer shows a title, the done line and the folded prompt", () => {
  it("o15_the_title_leads_and_the_ask_follows", async () => {
    const drawer = await openDrawer(full);
    const title = drawer.querySelector(".order-title")!;
    const ask = drawer.querySelector(".order-ask")!;
    expect(title.textContent).toContain("Give a Drawer tour");
    expect(ask.textContent).toContain("Give a tour of the Drawer");
  });

  it("o15_an_order_without_a_title_shows_its_ask", async () => {
    const drawer = await openDrawer({ kind: "work", ask: "Give a tour", limits: [] });
    expect(drawer.querySelector(".order-title")!.textContent).toContain("Give a tour");
    expect(drawer.querySelector(".order-ask")).toBeNull();
  });

  it("o15_the_done_mark_follows_the_agent_kind", async () => {
    for (const kind of KINDS) {
      const drawer = await openDrawer(full, { kind });
      const line = drawer.querySelector<HTMLElement>(".order-done-line")!;
      expect(line.textContent).toContain("The tour is written");

      expect(line.dataset.done, kind).toBe(String(kind === "done"));
      expect(line.querySelector("[role=img]")!.getAttribute("aria-label")).toBe(kind === "done" ? "Done" : "Not done");
      document.body.innerHTML = "";
    }
  });

  it("o15_no_done_no_line", async () => {
    const drawer = await openDrawer({ kind: "work", ask: "Give a tour", limits: [] });
    expect(drawer.querySelector(".order-done-line")).toBeNull();
  });

  it("o15_no_limits_part_is_drawn", async () => {
    const drawer = await openDrawer(full);
    
    for (const limit of limits) expect(drawer.textContent).not.toContain(limit);
    expect(drawer.textContent?.toLowerCase()).not.toContain("limits");
  });

  it("o15_no_list_is_drawn", async () => {
    const drawer = await openDrawer(full);
    await waitFor(() => expect(drawer.querySelector("summary")).not.toBeNull());
    expect(drawer.querySelector(":not(.order-prompt-body) > ul, h3")).toBeNull();
  });
});

describe("O16: the user edits the order in the Drawer", () => {
  const edit = async (order: Order, setOrder: (params: never) => object | null) => {
    const drawer = await openDrawer(order, { handlers: { "agent.setOrder": setOrder } });
    fireEvent.click(screen.getByRole("button", { name: "Edit order" }));

    return drawer;
  };

  const field = (name: string) => document.querySelector<HTMLInputElement>(`[name=${name}]`)!;

  it("o16_edit_opens_fields_with_the_current_text", async () => {
    await edit(full, () => ({}));
    expect(field("title").value).toBe("Give a Drawer tour");
    expect(field("ask").value).toBe("Give a tour of the Drawer");
    expect(field("done").value).toBe("The tour is written");
    expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
  });

  it("o16_save_sends_set_order_with_the_limits_unchanged", async () => {
    const sent: object[] = [];
    await edit(full, (params) => (sent.push(params), {}));
    fireEvent.input(field("title"), { target: { value: "Tour the Drawer" } });
    fireEvent.input(field("ask"), { target: { value: "Tour it" } });
    fireEvent.input(field("done"), { target: { value: "It is toured" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(document.querySelector(".order-edit")).toBeNull());
    expect(sent).toEqual([
      { id: "a", order: { kind: "work", title: "Tour the Drawer", ask: "Tour it", done: "It is toured", limits } },
    ]);
  });

  it("o16_a_blank_title_or_done_is_sent_absent", async () => {
    const sent: { order: Order }[] = [];
    await edit(full, (params) => (sent.push(params), {}));
    fireEvent.input(field("title"), { target: { value: "   " } });
    fireEvent.input(field("done"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect("title" in sent[0]!.order).toBe(false);
    expect("done" in sent[0]!.order).toBe(false);
  });

  it("o16_escape_cancels_and_sends_nothing", async () => {
    const sent: object[] = [];
    const drawer = await edit(full, (params) => (sent.push(params), {}));
    fireEvent.input(field("title"), { target: { value: "changed" } });
    fireEvent.keyDown(field("title"), { key: "Escape" });
    expect(document.querySelector(".order-edit")).toBeNull();
    expect(sent).toEqual([]);
    expect(drawer.querySelector(".order-title")!.textContent).toContain("Give a Drawer tour");
  });

  it("o16_a_rejected_save_keeps_the_input_and_shows_the_error", async () => {
    await edit(full, () => {
      throw new Error("order title is over 6 words");
    });
    fireEvent.input(field("title"), { target: { value: "one two three four five six seven" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("order title is over 6 words"));
    expect(field("title").value).toBe("one two three four five six seven");
    expect(screen.getByRole("img", { name: "Error" })).toBeTruthy();
  });

  it("o16_a_clarification_order_has_no_edit_button", async () => {
    await openDrawer(clarifying("which?"));
    expect(screen.queryByRole("button", { name: "Edit order" })).toBeNull();
  });
});
