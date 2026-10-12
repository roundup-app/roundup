import { fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { describe, expect, it } from "vitest";
import type { Kind } from "@contracts/Kind";
import type { Order } from "@contracts/agent/Order";
import type { RailNode } from "@contracts/agent/RailNode";
import { mountApp, select } from "../decisions/decisionsFixture";
import { agent, clarifying } from "../testing/nodes";

const limits = ["Change no file", "Keep it short", "Ask before deleting", "Use no network"];

const prompt = `## Details\n\n${"Walk through each part of the screenshot. ".repeat(60)}`;

const base: Order = {
  kind: "work",
  title: "Tour the Drawer",
  ask: "Give a tour of the Drawer",
  done: "the tour is written",
  limits,
};

const open = async (
  work: Order,
  over: { kind?: Kind; setOrder?: () => RailNode } = {},
) => {
  const sent: { id: string; order: Order }[] = [];

  await mountApp([], (app) => {
    app.handlers["rail.tree"] = () => [
      agent("a", over.kind ?? "working", "editing", { name: "alpha", order: 0, work }),
      agent("b", "working", "editing", { name: "beta", order: 1, work: clarifying("which?") }),
      agent("c", "working", "editing", { name: "gamma", order: 2, work: clarifying("why?") }),
    ];
    app.handlers["agent.spawnPrompt"] = () => ({ prompt });
    app.handlers["agent.setOrder"] = (params: { id: string; order: Order }) => {
      sent.push(params);

      return over.setOrder ? over.setOrder() : agent(params.id, "working", "editing", { name: "alpha", order: 0, work: params.order });
    };
  });
  select("alpha");
  await waitFor(() => expect(document.querySelector(".order-line")).not.toBeNull());
  fireEvent.click(document.querySelector(".order-line")!);

  return { drawer: await screen.findByLabelText("full order of alpha"), sent };
};

describe("O15: the Drawer shows a title, the done line and the folded prompt", () => {
  it("o15_the_title_leads_and_the_ask_follows", async () => {
    const { drawer } = await open(base);
    await waitFor(() => expect(drawer.querySelector("details")).not.toBeNull());

    const parts = [...drawer.querySelectorAll(".order-title, .order-ask, .order-done, summary")].map((each) => each.textContent);

    expect(parts).toEqual(["Tour the Drawer", "Give a tour of the Drawer", "the tour is written", "Prompt"]);
  });

  it("o15_an_order_without_a_title_shows_its_ask", async () => {
    const { drawer } = await open({ kind: "work", ask: "Give a tour", limits: [] });
    expect(drawer.querySelectorAll(".order-ask")).toHaveLength(1);
    expect(drawer.querySelector(".order-title")!.textContent).toBe("Give a tour");
  });

  it("o15_the_done_mark_follows_the_agent_kind", async () => {
    const kinds: Kind[] = ["error", "needs-you", "blocked", "working", "idle", "done"];

    for (const kind of kinds) {
      const { drawer } = await open(base, { kind });
      expect(drawer.querySelector(".order-done")!.getAttribute("data-done"), kind).toBe(kind === "done" ? "true" : "false");
      document.body.innerHTML = "";
    }
  });

  it("o15_no_done_no_line", async () => {
    const { drawer } = await open({ kind: "work", title: "Tour the Drawer", ask: "Give a tour", limits });
    expect(drawer.querySelector(".order-done")).toBeNull();
  });

  it("o15_no_limits_part_is_drawn", async () => {
    const { drawer } = await open(base);

    for (const limit of limits) expect(drawer.textContent).not.toContain(limit);
    expect(drawer.textContent?.toLowerCase()).not.toContain("limits");
  });

  it("o15_labels_are_sentence_case_and_no_list", async () => {
    const { drawer } = await open(base);
    await waitFor(() => expect(drawer.querySelector("details")).not.toBeNull());
    expect(drawer.querySelector("ul")).toBeNull();
    expect(drawer.querySelector("h3")).toBeNull();
    expect(drawer.querySelector("summary")!.textContent).toBe("Prompt");
    expect(getComputedStyle(drawer.querySelector("summary")!).fontWeight).not.toBe("600");
  });

  it("o15_a_closed_prompt_leaves_no_scroll_at_700x800", async () => {
    window.innerWidth = 700;
    window.innerHeight = 800;
    const { drawer } = await open(base);
    await waitFor(() => expect(drawer.querySelector("details")).not.toBeNull());
    expect(drawer.querySelector("details")!.open).toBe(false);
    expect(drawer.scrollHeight).toBeLessThanOrEqual(800);
    expect(drawer.scrollWidth).toBeLessThanOrEqual(drawer.clientWidth || 700);
  });
});

describe("O16: the user edits the order in the Drawer", () => {

  const edit = async (work: Order = base, over: Parameters<typeof open>[1] = {}) => {
    const opened = await open(work, over);
    fireEvent.click(screen.getByLabelText("Edit order"));

    return { ...opened, form: await screen.findByLabelText("edit order") };
  };

  // SAFETY: every labelled control of the edit form is an input or a textarea, which hold `value`.
  const field = (_form: HTMLElement, label: string) => screen.getByLabelText<HTMLInputElement>(label);


  it("o16_edit_opens_fields_with_the_current_text", async () => {
    const { form } = await edit();
    expect(field(form, "Title").value).toBe("Tour the Drawer");
    expect(field(form, "Ask").value).toBe("Give a tour of the Drawer");
    expect(field(form, "Done when").value).toBe("the tour is written");
    expect(screen.getByText("Save")).not.toBeNull();
    expect(screen.getByText("Cancel")).not.toBeNull();
  });

  it("o16_save_sends_set_order_with_the_limits_unchanged", async () => {
    const { form, sent } = await edit();
    fireEvent.input(field(form, "Title"), { target: { value: "New title" } });
    fireEvent.input(field(form, "Ask"), { target: { value: "New ask" } });
    fireEvent.input(field(form, "Done when"), { target: { value: "New done" } });
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toEqual({ id: "a", order: { kind: "work", title: "New title", ask: "New ask", done: "New done", limits } });
    await waitFor(() => expect(screen.queryByLabelText("edit order")).toBeNull());
  });

  it("o16_a_blank_title_or_done_is_sent_absent", async () => {
    const { form, sent } = await edit();
    fireEvent.input(field(form, "Title"), { target: { value: "  " } });
    fireEvent.input(field(form, "Done when"), { target: { value: "" } });
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]?.order).toEqual({ kind: "work", ask: "Give a tour of the Drawer", limits });
    expect("title" in (sent[0]?.order ?? {}) || "done" in (sent[0]?.order ?? {})).toBe(false);
  });

  it("o16_escape_cancels_and_sends_nothing", async () => {
    const { form, sent, drawer } = await edit();
    fireEvent.input(field(form, "Title"), { target: { value: "Changed" } });
    fireEvent.keyDown(field(form, "Title"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByLabelText("edit order")).toBeNull());
    expect(sent).toHaveLength(0);
    expect(drawer.querySelector(".order-title")!.textContent).toBe("Tour the Drawer");
  });

  it("o16_a_rejected_save_keeps_the_input_and_shows_the_error", async () => {
    const { form } = await edit(base, {
      setOrder: () => {
        throw new Error("order ask is over 200 characters");
      },
    });

    fireEvent.input(field(form, "Ask"), { target: { value: "x".repeat(201) } });
    fireEvent.click(screen.getByText("Save"));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("order ask is over 200 characters");
    expect(field(form, "Ask").value).toBe("x".repeat(201));
  });

  it("o16_a_clarification_order_has_no_edit_button", async () => {
    await open(clarifying("which build?"));
    expect(screen.queryByLabelText("Edit order")).toBeNull();
  });
});
