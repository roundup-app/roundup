import { fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { describe, expect, it } from "vitest";
import { card, decision, mountApp, rpcCalls, select } from "./decisionsFixture";

const scoped = (over = {}) => decision("d1", "a", { scopes: ["once", "session", "project"], ...over });

const open = async (value = scoped()) => {
  const mounted = await mountApp([value]);

  mounted.app.proof.value = "proof-1";
  select("alpha");
  await waitFor(() => expect(card()).not.toBeNull());

  return mounted;
};

const labels = () => [...card()!.querySelectorAll(".app-segment")].map((each) => each.textContent);

describe("u3794 a permission Card reads as who asks, why, what will happen and for how long", () => {
  it("u3794_title_reason_and_effects_for_bash_and_edit", async () => {
    await open();

    expect(card()!.querySelector(".decision-title")!.textContent).toBe("alpha wants to run rm -rf build");
    expect(card()!.querySelector(".decision-title code")!.textContent).toBe("rm -rf build");
    expect(card()!.querySelector(".decision-reason")!.textContent).toBe("clean");
  });

  it("u3794_an_edit_lists_its_file_and_line_counts_and_a_missing_reason_is_not_invented", async () => {
    await open(scoped({ tool: "Edit", args: JSON.stringify({ file_path: "/p/src/a.ts", old_string: "a\nb", new_string: "a\nb\nc\nd" }) }));

    expect(card()!.querySelector(".decision-title")!.textContent).toBe("alpha wants to edit /p/src/a.ts");
    expect(card()!.querySelector(".decision-reason")).toBeNull();
    expect(card()!.querySelector(".decision-effects")!.textContent).toContain("+4 −2");
    expect(card()!.hasAttribute("aria-describedby")).toBe(false);
  });

  it("u3794_another_tool_reads_wants_to_use_with_its_arguments", async () => {
    await open(scoped({ tool: "WebFetch", args: JSON.stringify({ url: "https://example.com" }) }));

    expect(card()!.querySelector(".decision-title")!.textContent).toBe("alpha wants to use WebFetch");
    expect(card()!.querySelector(".decision-args")!.textContent).toContain("https://example.com");
  });

  it("u3794_destructive_tags_and_hides_project", async () => {
    await open(scoped({ risk: "destructive", scopes: ["once", "session", "project"] }));

    expect(card()!.querySelector(".decision-tag")!.textContent).toBe("Destructive");
    expect(labels()).toEqual(["Once", "This session"]);
  });

  it("u3794_a_decision_without_risk_shows_no_tag", async () => {
    await open();

    expect(card()!.querySelector(".decision-tag")).toBeNull();
    expect(labels()).toEqual(["Once", "This session", "This Project"]);
  });

  it("u3794_arrows_pick_the_scope_and_enter_sends_it", async () => {
    const { app } = await open();

    fireEvent.keyDown(card()!, { key: "ArrowLeft" });
    fireEvent.keyDown(card()!, { key: "ArrowRight" });
    fireEvent.keyDown(card()!, { key: "ArrowRight" });
    fireEvent.keyDown(card()!, { key: "ArrowRight" });
    fireEvent.keyDown(card()!, { key: "Enter" });

    await waitFor(() => expect(rpcCalls(app, "decision.answer")).toEqual([{ id: "d1", answer: "allow", scope: "project", proof: "proof-1" }]));
  });

  it("u3794_esc_denies_once", async () => {
    const { app } = await open();

    fireEvent.keyDown(card()!, { key: "ArrowRight" });
    fireEvent.keyDown(card()!, { key: "Escape" });

    await waitFor(() => expect(rpcCalls(app, "decision.answer")).toEqual([{ id: "d1", answer: "deny", proof: "proof-1" }]));
  });

  it("u3794_enter_on_a_focused_button_activates_that_button", async () => {
    const { app } = await open();

    fireEvent.keyDown(within(card()!).getByRole("button", { name: "Deny" }), { key: "Enter" });

    expect(rpcCalls(app, "decision.answer")).toEqual([]);
  });

  it("u3794_keys_do_nothing_in_a_text_field_or_after_the_daemon_exits", async () => {
    const { app } = await open();
    const field = document.createElement("textarea");

    card()!.append(field);
    fireEvent.keyDown(field, { key: "Escape" });
    fireEvent.keyDown(field, { key: "Enter" });
    app.exitDaemon({ code: 1 });
    await waitFor(() => expect(within(card()!).getByRole("button", { name: "Allow" }).matches('[aria-disabled="true"]')).toBe(true));
    fireEvent.keyDown(card()!, { key: "Enter" });

    expect(rpcCalls(app, "decision.answer")).toEqual([]);
  });

  it("u3794_the_card_is_named_and_described", async () => {
    await open();

    const named = screen.getByRole("region", { name: "alpha wants to run rm -rf build" });

    expect(named).toBe(card());
    expect(named.getAttribute("aria-describedby")).toBe(card()!.querySelector(".decision-reason")!.id);
  });

  it("u3794_one_scope_draws_no_control", async () => {
    await open(scoped({ scopes: ["once"] }));

    expect(card()!.querySelector(".app-segments")).toBeNull();
  });
});
