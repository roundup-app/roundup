import { cleanup, fireEvent, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Checkpoint } from "@contracts/checkpoint/Checkpoint";
import type { PlanAgent } from "@contracts/workstream/PlanAgent";
import type { Rewind } from "@contracts/workstream/Rewind";
import type { RewindPlan } from "@contracts/workstream/RewindPlan";
import { RpcError } from "../app/seam";
import { agent, door, event, NOW } from "../testing/nodes";
import { mountThread } from "./threadFixture";

const tree = () => [door("r1", "working", "working", { name: "lead" }), agent("a1", "working", "x", { parent: "r1", name: "ann" })];

const checkpoint = (id: number, over: Partial<Checkpoint> = {}): Checkpoint => ({ id, workstream: "r1", at: NOW, title: `Cp ${id}`, blocks: [], rewindable: true, ...over });

const planAgent = (name: string, over: Partial<PlanAgent> = {}): PlanAgent => ({ agent: name, name, takeover: false, created_after: false, files_changed: [], ...over });

const plan = (agents: PlanAgent[]): RewindPlan => ({ agents, files_changed: agents.some((each) => each.files_changed.length > 0) });


const card = (id: number) => document.querySelector<HTMLElement>(`[data-checkpoint='${id}']`)!;

const word = (id: number) => [...card(id).querySelectorAll("button")].find((each) => each.textContent?.trim() === "rewind" && !each.closest("[data-rewind-prompt]")) ?? null;

const prompt = () => document.querySelector<HTMLElement>("[data-rewind-prompt]");

const button = (name: string) => [...prompt()!.querySelectorAll("button")].find((each) => each.textContent?.trim() === name)!;

const calls = (method: string) => app().calls.filter((each) => each.method === method);


let current: Awaited<ReturnType<typeof mountThread>>["app"] | null = null;

const app = () => current!;


type Setup = { checkpoints?: Checkpoint[]; plan?: RewindPlan; rewind?: () => Rewind | Promise<Rewind> };

const open = async (setup: Setup = {}) => {
  const mounted = await mountThread(tree(), { checkpoints: setup.checkpoints ?? [checkpoint(1), checkpoint(2)] });

  current = mounted.app;
  mounted.app.handlers["workstream.rewindPlan"] = () => setup.plan ?? plan([planAgent("lead"), planAgent("ann")]);
  mounted.app.handlers["workstream.rewind"] = setup.rewind ?? (() => ({ rewound: [], removed: [], skipped: [] }));
  await vi.waitFor(() => expect(document.querySelectorAll("[data-checkpoint]").length).toBeGreaterThan(0));

  return mounted;
};

const choose = async (id: number) => {
  fireEvent.click(word(id)!);
  await vi.waitFor(() => expect(prompt()!.querySelector("[data-rewind-agent]")).not.toBeNull());
};

afterEach(() => {
  cleanup();
  current = null;
});

describe("u374 the user rewinds a Workstream from a Checkpoint", () => {
  it("u374_only_a_rewindable_checkpoint_has_the_word", async () => {
    await open({ checkpoints: [checkpoint(1, { rewindable: false }), checkpoint(2)] });

    expect(word(1)).toBeNull();
    expect(word(2)).not.toBeNull();
    expect(card(2).querySelector(".thread-checkpoint-time")!.nextElementSibling).toBe(word(2));
    expect(getComputedStyle(word(2)!).minHeight).toBe("var(--space-5)");
  });

  it("u374_the_plan_lists_each_agent_and_calls_the_plan_once", async () => {
    await open({ plan: plan([planAgent("lead"), planAgent("ann", { created_after: true }), planAgent("bob", { takeover: true })]) });
    await choose(2);

    expect(calls("workstream.rewindPlan")).toEqual([{ method: "workstream.rewindPlan", params: { id: "r1", checkpoint: 2 } }]);
    expect(prompt()!.closest("[data-checkpoint]")).toBe(card(2));
    expect(prompt()!.querySelector(".thread-rewind-title")!.textContent).toBe("rewind to Cp 2?");
    expect([...prompt()!.querySelectorAll("[data-rewind-agent]")].map((each) => each.textContent!.replace(/\s+/g, " ").trim())).toEqual(["lead back", "ann removed", "bob under takeover rewind it too"]);

    fireEvent.keyDown(prompt()!, { key: "Escape" });

    expect(prompt()).toBeNull();
    expect(calls("workstream.rewindPlan")).toHaveLength(1);
    expect(calls("workstream.rewind")).toHaveLength(0);

    await choose(2);
    fireEvent.click(button("keep"));

    expect(prompt()).toBeNull();
    expect(calls("workstream.rewind")).toHaveLength(0);
  });

  it("u374_a_takeover_agent_is_unchecked_by_default", async () => {
    await open({ plan: plan([planAgent("lead"), planAgent("bob", { takeover: true })]) });
    await choose(1);

    const boxes = prompt()!.querySelectorAll<HTMLInputElement>("input[type=checkbox]");

    expect(boxes).toHaveLength(1);
    expect(boxes[0]!.checked).toBe(false);
    expect(boxes[0]!.closest("label")!.textContent!.trim()).toBe("rewind it too");
  });

  it("u374_no_files_changed_asks_nothing_about_files", async () => {
    const { app: fake } = await open({ plan: plan([planAgent("lead"), planAgent("bob", { takeover: true })]) });

    fake.proof.value = "proof-1";
    await choose(1);
    expect(prompt()!.querySelector("[data-rewind-files]")).toBeNull();
    expect([...prompt()!.querySelectorAll("button")].map((each) => each.textContent!.trim())).toEqual(["rewind", "keep"]);

    fireEvent.click(prompt()!.querySelector("input[type=checkbox]")!);
    fireEvent.click(button("rewind"));
    await vi.waitFor(() => expect(calls("workstream.rewind")).toHaveLength(1));

    expect(calls("workstream.rewind")[0]!.params).toEqual({ id: "r1", checkpoint: 1, files: "keep", takeover: ["bob"], proof: "proof-1" });
  });

  it("u374_changed_files_ask_which_and_preselect_nothing", async () => {
    const paths = ["a", "b", "c", "d", "e", "f", "g"];

    await open({ plan: plan([planAgent("lead", { files_changed: paths.slice(0, 4) }), planAgent("ann", { files_changed: paths.slice(3) })]) });
    await choose(1);

    const files = prompt()!.querySelector<HTMLElement>("[data-rewind-files]")!;

    expect(files.querySelector("p")!.textContent).toBe("files changed after this");
    expect([...files.querySelectorAll("ul li")].map((each) => each.textContent)).toEqual(["a", "b", "c", "d", "e", "+2 more"]);
    expect([...files.querySelectorAll("label")].map((each) => each.textContent!.trim())).toEqual(["chats only", "chats and files"]);
    expect([...files.querySelectorAll<HTMLInputElement>("input")].map((each) => each.checked)).toEqual([false, false]);
    expect(button("rewind").disabled).toBe(true);

    fireEvent.click(screen.getByLabelText("chats only"));

    expect(button("rewind").disabled).toBe(false);
  });

  it("u374_the_choice_sends_keep_or_restore", async () => {
    const changed = plan([planAgent("lead", { files_changed: ["a"] })]);

    for (const [label, files] of [["chats only", "keep"], ["chats and files", "restore"]] as const) {
      await open({ plan: changed });
      await choose(1);
      fireEvent.click(screen.getByLabelText(label));
      fireEvent.click(button("rewind"));
      await vi.waitFor(() => expect(calls("workstream.rewind")).toHaveLength(1));

      expect(calls("workstream.rewind")[0]!.params).toMatchObject({ id: "r1", checkpoint: 1, files, takeover: [] });
      cleanup();
    }
  });

  it("u374_pending_disables_the_prompt", async () => {
    const { app: fake } = await open({ plan: plan([planAgent("lead", { files_changed: ["a"] }), planAgent("bob", { takeover: true })]), rewind: () => new Promise(() => {}) });

    fake.proof.value = "p";
    await choose(1);
    fireEvent.click(screen.getByLabelText("chats only"));
    fireEvent.click(button("rewind"));
    await vi.waitFor(() => expect(calls("workstream.rewind")).toHaveLength(1));

    expect([...prompt()!.querySelectorAll<HTMLButtonElement | HTMLInputElement>("button, input")].every((each) => each.disabled)).toBe(true);
    expect(word(1)).toBeNull();
    expect(word(2)).toBeNull();
    fireEvent.keyDown(prompt()!, { key: "Escape" });
    expect(prompt()).not.toBeNull();
    expect(document.querySelectorAll("[data-rail-row], .rail-row").length).toBeGreaterThan(0);
  });

  it("u374_rewound_marks_the_checkpoint_and_removes_later_words", async () => {
    const { app: fake } = await open({ checkpoints: [checkpoint(1), checkpoint(2), checkpoint(3)], rewind: () => new Promise(() => {}) });

    await choose(2);
    fireEvent.click(button("rewind"));
    await vi.waitFor(() => expect(calls("workstream.rewind")).toHaveLength(1));

    fake.emit(event({ name: "workstream.rewound", data: { id: "other", checkpoint: 2 } }));
    expect(prompt()).not.toBeNull();

    fake.emit(event({ name: "workstream.rewound", data: { id: "r1", checkpoint: 2 } }));
    await vi.waitFor(() => expect(prompt()).toBeNull());

    const mark = card(2).querySelector<HTMLElement>("[data-rewound]")!;

    expect(mark.textContent).toBe("rewound to here");
    expect(getComputedStyle(mark).color).toBe("var(--grey)");
    expect(card(3)).not.toBeNull();
    expect(word(3)).toBeNull();
    expect(word(1)).not.toBeNull();
    expect(card(1).querySelector("[data-rewound]")).toBeNull();
  });

  it("u374_a_failure_shows_its_message", async () => {
    await open({
      rewind: () => {
        throw new RpcError(-32000, "worktree is busy");
      },
    });
    await choose(1);
    fireEvent.click(button("rewind"));

    await vi.waitFor(() => expect(prompt()!.querySelector("[role=alert]")!.textContent).toBe("worktree is busy"));

    expect(button("rewind").disabled).toBe(false);
    expect(card(1).querySelector("[data-rewound]")).toBeNull();
  });
});
