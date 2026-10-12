import { fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { describe, expect, it } from "vitest";
import { mountApp, select } from "../decisions/decisionsFixture";
import type { Order } from "@contracts/agent/Order";
import { agent, clarifying, door } from "../testing/nodes";

const ask = "Give a tour of the Drawer";

const limits = ["Change no file", "Keep it short", "Ask before deleting", "Use no network"];

const prompt = `## Details\n\n${"Walk through each part of the screenshot. ".repeat(60)}\n\n- **bold** item`;

const open = async (done: string | undefined, read: () => { prompt: string | null }) => {
  const order: Order = { kind: "work", ask, limits };

  if (done !== undefined) order.done = done;

  await mountApp([], (app) => {
    app.handlers["rail.tree"] = () => [
      agent("a", "working", "editing", {
        name: "alpha",
        order: 0,
        work: order,
      }),
      agent("b", "working", "editing", { name: "beta", order: 1, work: clarifying("which?") }),
      door("r", "working", "editing", { name: "harbor", order: 2, work: clarifying("why?") }),
    ];
    app.handlers["agent.spawnPrompt"] = read;
  });
  select("alpha");
  await waitFor(() => expect(document.querySelector(".order-line")).not.toBeNull());
  fireEvent.click(document.querySelector(".order-line")!);

  return await screen.findByLabelText("full order of alpha");
};

describe("O10: the Drawer shows the order in parts", () => {
  it("o10_the_prompt_is_closed_by_default", async () => {
    const drawer = await open("x", () => ({ prompt }));
    await waitFor(() => expect(drawer.querySelector("details")).not.toBeNull());
    expect(drawer.querySelector("details")!.open).toBe(false);
  });

  it("o10_a_closed_prompt_leaves_no_scroll_at_700x800", async () => {
    window.innerWidth = 700;
    window.innerHeight = 800;
    const drawer = await open("x", () => ({ prompt }));
    await waitFor(() => expect(drawer.querySelector("details")).not.toBeNull());
    expect(drawer.querySelector("details")!.open).toBe(false);
    expect(drawer.scrollHeight).toBeLessThanOrEqual(800);
    expect(drawer.scrollWidth).toBeLessThanOrEqual(drawer.clientWidth || 700);
  });

  it("o10_the_open_prompt_is_markdown_and_scrolls_inside_its_part", async () => {
    const drawer = await open("x", () => ({ prompt }));
    await waitFor(() => expect(drawer.querySelector("details")).not.toBeNull());
    fireEvent.click(drawer.querySelector("summary")!);
    const body = drawer.querySelector<HTMLElement>(".order-prompt-body")!;
    expect(body.querySelector("h2")?.textContent).toBe("Details");
    expect(body.querySelector("strong")?.textContent).toBe("bold");
    expect(getComputedStyle(body).overflow).toBe("auto");
    expect(getComputedStyle(drawer).overflowX).not.toBe("scroll");
  });

  it("o10_no_prompt_no_part", async () => {
    const drawer = await open(undefined, () => ({ prompt: null }));
    await waitFor(() => expect(drawer.querySelector(".order-ask")).not.toBeNull());
    await new Promise((r) => setTimeout(r, 20));
    expect(drawer.querySelector("details")).toBeNull();
      });

  it("o10_a_failed_read_shows_its_text", async () => {
    const drawer = await open("x", () => {
      throw new Error("no such Agent");
    });

    await waitFor(() => expect(drawer.querySelector(".order-prompt-error")).not.toBeNull());
    expect(drawer.querySelector(".order-prompt-error")!.textContent).toContain("no such Agent");
  });
});
