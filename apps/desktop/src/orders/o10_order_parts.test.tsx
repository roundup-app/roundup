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

  return await screen.findByLabelText("Full order of alpha");
};

describe("O17: the Drawer shows no Prompt", () => {
  it("o17_a_failed_read_still_shows_its_text", async () => {
    const drawer = await open("x", () => {
      throw new Error("no such Agent");
    });

    await waitFor(() => expect(drawer.querySelector(".order-prompt-error")).not.toBeNull());
    expect(drawer.querySelector(".order-prompt-error")!.textContent).toContain("no such Agent");
  });

  it("o17_no_prompt_is_drawn", async () => {
    const drawer = await open("x", () => ({ prompt }));
    await new Promise((r) => setTimeout(r, 20));
    expect(drawer.querySelector("details, .order-prompt")).toBeNull();
    expect(drawer.textContent).not.toContain("Prompt");
    expect(drawer.textContent).not.toContain("Walk through");
  });
});
