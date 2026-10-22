import { cleanup, fireEvent, screen, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { agent } from "../testing/nodes";
import type { ConversationOverview } from "@contracts/agent/ConversationOverview";
import type { ContextPart } from "@contracts/agent/ContextPart";
import { mountPane } from "./paneHarness";

afterEach(cleanup);

const base = { program: "Claude Code", id: "opaque", limit: 200000 };

const split: ContextPart[] = [{ kind: "system", tokens: 6000 }, { kind: "tools", tokens: 18000 }, { kind: "files", tokens: 12000 }, { kind: "conversation", tokens: 40000 }, { kind: "other", tokens: 8000 }];

const open = async (overview: ConversationOverview) => {
  const { connected, app } = await mountPane([agent("a", "done", "finished", { terminal_id: null, overview })]);
  app.handlers["agent.spawnPrompt"] = () => ({ prompt: "p" });
  connected.rail.select("a");
  await screen.findByRole("button", { name: "Copy session id" });
};

describe("U83b context bar", () => {
  it("u83b_parts_fill_the_bar_in_order_and_label_their_tokens", async () => {
    await open({ ...base, used: 84000, context_parts: split });
    expect(screen.getByText("84K of 200K")).toBeTruthy();
    expect(screen.getByText("42%")).toBeTruthy();
    const items = within(screen.getByRole("list", { name: "Context" })).getAllByRole("listitem");
    expect(items.map((item) => item.textContent)).toEqual(["System prompt6K", "Tools18K", "Files12K", "Conversation40K", "Other8K"]);
    expect(screen.getByRole("meter").getAttribute("aria-valuemax")).toBe("200000");
  });

  it("u83b_arrow_keys_and_hover_show_one_part_in_the_live_region", async () => {
    await open({ ...base, used: 84000, context_parts: split });
    const buttons = screen.getAllByRole("button", { name: /Tools|System prompt/ });
    buttons[0]!.focus();
    expect(document.querySelector(".context-live")!.textContent).toBe("System prompt: 6,000 tokens, 3% of the limit");
    fireEvent.keyDown(buttons[0]!, { key: "ArrowRight" });
    expect(document.activeElement).toBe(buttons[1]);
    expect(document.querySelector(".context-live")!.textContent).toContain("Tools: 18,000 tokens, 9%");
    fireEvent.mouseEnter(screen.getByText("Files").closest("li")!);
    expect(document.querySelector(".context-live")!.textContent).toContain("Files: 12,000 tokens");
    expect(screen.getByText("Tools").closest("li")!.hasAttribute("data-dim")).toBe(true);
    expect(screen.getByText("Files").closest("li")!.hasAttribute("data-dim")).toBe(false);
  });

  it("u83b_missing_split_limit_or_used_shows_only_what_is_known", async () => {
    await open({ ...base, used: 84000 });
    expect(within(screen.getByRole("list", { name: "Context" })).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["Used84K"]);
    cleanup();
    await open({ program: "Claude Code", id: "opaque", used: 84000 });
    expect(screen.getByText("84K")).toBeTruthy();
    expect(screen.queryByRole("meter")).toBeNull();
    cleanup();
    const { connected } = await mountPane([agent("a", "done", "finished", { terminal_id: null, overview: { ...base, id: "no-used" } })]);
    connected.rail.select("a");
    await screen.findByRole("button", { name: "Copy session id" });
    expect(screen.queryByRole("meter")).toBeNull();
    expect(screen.queryByText("Context")).toBeNull();
  });

  it.each([[160000, "80% near the limit"], [190000, "95% full"], [100000, "50%"]])("u83b_warning_text_does_not_rely_on_colour (%i)", async (used, text) => {
    await open({ ...base, used });
    expect(screen.getByText(text)).toBeTruthy();
  });
});
