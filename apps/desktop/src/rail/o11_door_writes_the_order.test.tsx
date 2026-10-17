import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { message } from "../testing/centreFixture";
import { agent, door, USER, workstream } from "../testing/nodes";
import { mountRail, railCallsTo } from "./railFixture";

afterEach(cleanup);

const sent = message(1, { from: USER, to: "g" });

const fresh = agent("fresh", "idle", "starting");

const open = () => fireEvent.keyDown(document, { key: "n", metaKey: true, shiftKey: true });

const field = () => screen.getByLabelText<HTMLTextAreaElement>("Task");

const submit = (text: string) => {
  fireEvent.input(field(), { target: { value: text } });
  fireEvent.keyDown(field(), { key: "Enter" });
};

describe("o11 the Door writes the order for a prompt the user types", () => {
  it("o11_a_typed_prompt_goes_to_the_door_as_a_note", async () => {
    const mounted = await mountRail([door("g", "idle", "idle")]);
    let settle = () => {};

    mounted.app.handlers["message.send"] = () =>
      new Promise((resolve) => {
        settle = () => resolve(sent);
      });
    mounted.rail.select("g");
    open();
    submit("  fix the build  ");

    await waitFor(() => expect(railCallsTo(mounted.app, "message.send")).toEqual([{ to: "g", kind: "note", body: "fix the build", replyTo: null }]));
    expect(railCallsTo(mounted.app, "agent.spawn")).toEqual([]);
    expect(screen.queryByText("Asking the supervisor…")).toBeNull();


    await waitFor(() => expect(screen.getByText("Asking the supervisor…")).toBeTruthy());


    const rows = screen.getAllByRole("treeitem").length;

    settle();
    await waitFor(() => expect(screen.queryByLabelText("Task")).toBeNull());
    expect(screen.queryByText("Asking the supervisor…")).toBeNull();
    expect(screen.getAllByRole("treeitem").length).toBe(rows);
    expect(mounted.rail.selected()).toBe("g");
  });

  it("o11_a_failed_send_keeps_the_text", async () => {
    const mounted = await mountRail([door("g", "idle", "idle")]);

    mounted.app.handlers["message.send"] = () => {
      throw new Error("no such door");
    };

    mounted.rail.select("g");
    open();
    submit("fix");

    await waitFor(() => expect(screen.getByText("no such door")).toBeTruthy());
    expect(field().value).toBe("fix");
  });

  it("o11_an_empty_prompt_still_spawns_a_clarifying_agent", async () => {
    const mounted = await mountRail([door("g", "idle", "idle")]);

    mounted.app.handlers["agent.spawn"] = () => fresh;
    mounted.rail.select("g");
    open();
    submit("   ");

    await waitFor(() => expect(railCallsTo(mounted.app, "agent.spawn")).toEqual([{ cwd: "/p", prompt: null, parent: "g", model: null, effort: null }]));
    expect(railCallsTo(mounted.app, "message.send")).toEqual([]);
  });

  it("o13_a_typed_prompt_without_a_running_door_is_the_ask", async () => {
    const mounted = await mountRail([workstream("g")]);

    mounted.app.handlers["agent.spawn"] = () => fresh;
    mounted.rail.select("g");
    open();
    submit("fix");

    await waitFor(() => expect(railCallsTo(mounted.app, "agent.spawn")).toEqual([{ cwd: "/p", prompt: "fix", parent: "g", model: null, effort: null }]));
    expect(railCallsTo(mounted.app, "message.send")).toEqual([]);
  });
});
