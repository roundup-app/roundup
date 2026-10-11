import { cleanup } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Order } from "@contracts/agent/Order";
import { agent, clarifying, door, event, NOW, USER } from "../testing/nodes";
import { message, mountThread, sent } from "./threadFixture";

const ask = (text: string): Order => ({ kind: "work", ask: text, limits: [] });

const status = (id: string, kind: "working" | "idle", label: string) => event({ name: "agent.status", data: { status_revision: "2", attempt: "1", id, status: { kind, label, since: NOW } } });

const nowLines = () => [...document.querySelectorAll<HTMLElement>("[data-now]")];

const words = () => [...document.querySelectorAll("[data-message-status]")].map((each) => each.textContent);

const taken = () => document.querySelectorAll("[data-message-taken]").length;

const DOOR = { kind: "agent", id: "r1", parent: null } as const;

afterEach(cleanup);

describe("u195 the Thread says what the Door works on and which Messages wait", () => {
  it("u195_now_lines_name_each_working_agent_and_its_order", async () => {
    const long = "x".repeat(300);

    await mountThread([
      door("r1", "working", "editing", { name: "lead", work: ask("fix the build") }),
      agent("a", "working", "testing", { parent: "r1", name: "ann", work: ask(long) }),
      agent("b", "idle", "idle", { parent: "r1", name: "bob" }),
      agent("c", "needs-you", "asks", { parent: "r1", name: "cy", work: clarifying("which one?") }),
    ]);
    await vi.waitFor(() => expect(nowLines()).toHaveLength(3));

    expect(nowLines().map((each) => each.textContent)).toEqual(["leadediting", `ann${long}testing`, "cywhich one?asks"]);
    expect(nowLines()[1]!.querySelector(".thread-now-ask")!.getAttribute("title")).toBe(long);
    expect(getComputedStyle(nowLines()[1]!.querySelector(".thread-now-ask")!).textOverflow).toBe("ellipsis");
  });

  it("u195_a_door_that_waits_says_idle_and_an_idle_subagent_has_no_line", async () => {
    await mountThread([door("r1", "idle", "idle", { name: "lead" }), agent("a", "idle", "idle", { parent: "r1", name: "ann" })]);
    await vi.waitFor(() => expect(nowLines()).toHaveLength(1));

    expect(nowLines()[0]!.textContent).toBe("leadidle");
  });

  it("u195_a_pending_message_from_you_reads_queued", async () => {
    await mountThread([door("r1", "working", "x", { name: "lead" })], {
      messages: [
        message(1, { from: USER, to: "r1", status: "pending" }),
        message(2, { from: USER, to: "r1", status: "held" }),
        message(3, { from: USER, to: "r1", status: "dropped" }),
        message(4, { from: USER, to: "r1" }),
        message(5, { from: DOOR, to: "you", status: "pending" }),
      ],
    });
    await vi.waitFor(() => expect(words()).toHaveLength(4));

    expect(words()).toEqual(["queued", "waiting for approval", "not delivered", "pending"]);
    expect(taken()).toBe(0);
  });

  it("u195_a_queued_message_then_delivered_reads_taken_up_then_nothing", async () => {
    const { app } = await mountThread([door("r1", "working", "x", { name: "lead" })], { messages: [message(4, { from: USER, to: "r1", status: "delivered" })] });

    app.emit(sent(message(1, { from: USER, to: "r1", status: "pending" })));
    await vi.waitFor(() => expect(words()).toEqual(["queued"]));

    app.emit(event({ name: "message.delivered", data: message(1, { from: USER, to: "r1" }) }));
    await vi.waitFor(() => expect(taken()).toBe(1));

    expect(words()).toEqual([]);
    expect(document.querySelector("[data-message-taken]")!.textContent).toBe("taken up");
    expect(document.querySelector("[data-message='4']")!.querySelector("[data-message-taken]")).toBeNull();

    app.emit(status("r1", "idle", "idle"));
    await vi.waitFor(() => expect(taken()).toBe(0));
  });

  it("u195_status_attribute_and_calls_are_unchanged", async () => {
    const { app } = await mountThread([door("r1", "working", "x", { name: "lead" })], { messages: [message(1, { from: USER, to: "r1", status: "pending" })] });
    await vi.waitFor(() => expect(words()).toEqual(["queued"]));

    expect(document.querySelector("[data-message='1']")!.getAttribute("data-status")).toBe("pending");
    expect(app.calls.map((call) => call.method).filter((method) => method.startsWith("message.") || method.startsWith("route.") || method.startsWith("takeover.begin"))).toEqual(["message.list"]);
  });
});
