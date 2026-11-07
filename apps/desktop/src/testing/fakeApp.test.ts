import { describe, expect, it } from "vitest";
import { createFakeApp } from "./fakeApp";
import { seedApp } from "./seeds";

describe("u1 the fake App", () => {
  it.each(["rail.tree", "terminal.list", "todo.list", "pad.list"] as const)(
    "u1_the_fake_answers_%s_with_an_empty_list_by_default",
    async (method) => {
      expect(await createFakeApp().rpc(method, null)).toEqual([]);
    },
  );

  it("u1_the_fake_answers_provenance_history_with_an_empty_list_by_default", async () => {
    expect(await createFakeApp().rpc("provenance.history", { item: "todo:1" })).toEqual([]);
  });

  it("u1_the_fake_fails_a_method_no_test_opted_into", async () => {
    await expect(createFakeApp().rpc("todo.get", { id: 1 })).rejects.toMatchObject({
      code: -32601,
      message: "no handler for todo.get",
    });
  });
});

describe("a26a the seeds refuse what the Daemon refuses", () => {
  it("a26a_seed_rail_move_of_a_workstream_under_a_non_group_is_conflict", async () => {
    const { app } = seedApp("tree-40", Date.now());
    const tree = await app.rpc("rail.tree", null);
    const [one, two] = tree.filter((node) => node.kind === "workstream").map((node) => node.id);
    const events: string[] = [];
    await app.subscribe((event) => events.push(event.name), {});
    const before = JSON.stringify(await app.rpc("rail.tree", null));

    await expect(app.rpc("rail.move", { id: String(one), parent: String(two), index: 0 })).rejects.toMatchObject({ code: -32003, message: expect.stringContaining(String(two)) });
    expect(JSON.stringify(await app.rpc("rail.tree", null))).toBe(before);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(events).not.toContain("rail.changed");
    await expect(app.rpc("rail.move", { id: String(one), parent: null, index: 0 })).resolves.toBeDefined();
  });
});
