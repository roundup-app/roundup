import { cleanup, fireEvent, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { door } from "../testing/nodes";
import { mountThread, threadInput } from "./threadFixture";

const tree = () => [door("workstream", "idle", "idle")];

const SKILLS = [
  { name: "animate", description: "Build an animation" },
  { name: "reduce", description: "Shorten it" },
  { name: "review", description: "Judge a diff" },
];

const calls = (app: { calls: { method: string; params: unknown }[] }, method: string) => app.calls.filter((call) => call.method === method);

const typeText = (text: string) => {
  threadInput().value = text;
  fireEvent.input(threadInput());
};

const names = () => [...document.querySelectorAll<HTMLElement>("[data-skill]")].map((row) => row.dataset.skill);

const open = async (reply: unknown = { skills: SKILLS }) => {
  const mounted = await mountThread(tree());

  mounted.app.handlers["agent.skills"] = () => reply;
  threadInput().focus();
  typeText("/");
  await waitFor(() => expect(document.querySelector("[data-skills]")?.textContent).not.toBe("loading Skills…"));

  return mounted;
};

afterEach(cleanup);

describe("u198 / lists the Door's Skills", () => {
  it("u198_slash_opens_the_list_with_names_and_descriptions", async () => {
    await open();

    expect(names()).toEqual(["animate", "reduce", "review"]);
    expect(document.querySelector("[data-skill=reduce]")?.textContent).toContain("Shorten it");
  });

  it("u198_each_open_fetches_the_list_once", async () => {
    const { app } = await open();

    typeText("/r");
    typeText("/");
    expect(calls(app, "agent.skills")).toHaveLength(1);
    expect(calls(app, "agent.skills")[0]?.params).toEqual({ id: "workstream" });

    typeText("");
    await waitFor(() => expect(document.querySelector("[data-skills]")).toBeNull());
    typeText("/");
    await waitFor(() => expect(calls(app, "agent.skills")).toHaveLength(2));
  });

  it("u198_loading_error_and_empty_rows", async () => {
    const mounted = await mountThread(tree());

    mounted.app.handlers["agent.skills"] = () => new Promise(() => {});
    typeText("/");
    expect(document.querySelector("[data-skills]")?.textContent).toBe("loading Skills…");
    cleanup();

    const failing = await mountThread(tree());

    failing.app.handlers["agent.skills"] = () => {
      throw new Error("boom");
    };
    typeText("/");
    await waitFor(() => expect(document.querySelector("[data-skills] [role=alert]")?.textContent).toContain("boom"));
    cleanup();

    const empty = await mountThread(tree());

    empty.app.handlers["agent.skills"] = () => ({ skills: [] });
    typeText("/");
    await waitFor(() => expect(document.querySelector("[data-skills]")?.textContent).toBe("no Skills"));
  });

  it("u198_a_slash_elsewhere_opens_nothing", async () => {
    const { app } = await mountThread(tree());

    app.handlers["agent.skills"] = () => ({ skills: SKILLS });
    typeText("a/");
    typeText("a\n/");
    expect(document.querySelector("[data-skills]")).toBeNull();
    expect(calls(app, "agent.skills")).toEqual([]);
  });

  it("u198_typing_filters_the_list", async () => {
    await open();

    typeText("/re");
    expect(names()).toEqual(["reduce", "review"]);

    typeText("/NIM");
    expect(names()).toEqual(["animate"]);

    typeText("/zzz");
    expect(document.querySelector("[data-skills]")?.textContent).toBe("no Skill matches");
  });

  it("u198_arrows_move_enter_and_tab_pick_esc_closes", async () => {
    const { app } = await open();

    fireEvent.keyDown(threadInput(), { key: "ArrowUp" });
    expect(document.querySelector("[data-highlighted]")?.getAttribute("data-skill")).toBe("review");
    fireEvent.keyDown(threadInput(), { key: "ArrowDown" });
    fireEvent.keyDown(threadInput(), { key: "ArrowDown" });
    expect(document.querySelector("[data-highlighted]")?.getAttribute("data-skill")).toBe("reduce");

    fireEvent.keyDown(threadInput(), { key: "Tab" });
    expect(threadInput().value).toBe("/reduce ");
    expect(document.querySelector("[data-skills]")).toBeNull();

    typeText("/");
    await waitFor(() => expect(names().length).toBe(3));
    fireEvent.keyDown(threadInput(), { key: "Escape" });
    expect(document.querySelector("[data-skills]")).toBeNull();
    expect(threadInput().value).toBe("/");
    expect(calls(app, "message.send")).toEqual([]);
  });

  it("u198_the_input_keeps_focus", async () => {
    await open();

    fireEvent.keyDown(threadInput(), { key: "ArrowDown" });
    fireEvent.keyDown(threadInput(), { key: "Enter" });

    expect(document.activeElement).toBe(threadInput());
  });

  it("u198_pointer_pick_keeps_focus", async () => {
    await open();

    const row = document.querySelector<HTMLElement>("[data-skill=review]")!;

    expect(fireEvent.mouseDown(row)).toBe(false);
    fireEvent.click(row);

    expect(threadInput().value).toBe("/review ");
    expect(document.activeElement).toBe(threadInput());
  });

  it("u198_pick_fills_the_input_and_sending_calls_message_send_once", async () => {
    const { app } = await open();

    typeText("/re");
    fireEvent.keyDown(threadInput(), { key: "Enter" });

    expect(threadInput().value).toBe("/reduce ");
    expect(calls(app, "message.send")).toEqual([]);

    fireEvent.keyDown(threadInput(), { key: "Enter" });
    await waitFor(() => expect(calls(app, "message.send")).toHaveLength(1));

    expect(calls(app, "message.send")[0]?.params).toMatchObject({ body: "/reduce" });
  });

  it("u198_a_banned_command_is_never_offered", async () => {
    await open({ skills: [...SKILLS, ...["model", "effort", "compact", "clear", "p:model"].map((name) => ({ name, description: "" }))] });

    expect(names()).toEqual(["animate", "reduce", "review"]);

    typeText("/model");
    expect(names()).toEqual([]);
  });

  it("u198_composer_behaviours_hold_with_the_list", async () => {
    await open();

    fireEvent.keyDown(threadInput(), { key: "Enter", shiftKey: true });
    expect(threadInput().value).toBe("/");
    expect(document.querySelector("[data-thread-input]")).not.toBeNull();
    expect(document.querySelector(".thread-send")).not.toBeNull();
  });
});
