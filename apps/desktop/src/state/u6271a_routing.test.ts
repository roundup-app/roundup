import { describe, expect, it } from "vitest";
import type { Ask } from "@contracts/ask/Ask";
import type { SendParams } from "@contracts/ask/SendParams";
import { connectEvents } from "../app/events";
import { createFakeApp } from "../testing/fakeApp";
import { createAsks } from "./asks";

const reply = (params: SendParams): Ask => ({ id: params.submission ?? "a", text: params.text, at: 1n, parts: [], submission: params.submission ?? "" });

describe("u6271a_routing", () => {
  it("u6271a_a_destination_in_the_second_project_reaches_its_door", async () => {
    const first = createFakeApp();
    const second = createFakeApp();
    const first_sent: SendParams[] = [];
    const second_sent: SendParams[] = [];
    first.handlers["ask.send"] = (params: SendParams) => { first_sent.push(params);

 return reply(params); };

    second.handlers["ask.send"] = (params: SendParams) => { second_sent.push(params);

 return reply(params); };

    const open = [{ name: "a", path: "/a" }, { name: "b", path: "/b" }];
    const routing = { app: { forProject: (path: string) => (path === "/b" ? second : first) }, open: () => open };
    const asks = createAsks(first, await connectEvents(first), undefined, routing);

    const outcome = await asks.send({
      text: "fix the  login  start docs tidy which?",
      submission: "s1",
      parts: [
        { text: "fix the  login ", placement: { kind: "routed", workstream: "w2", project: "b" } },
        { text: "start docs", placement: { kind: "new", title: "docs", project: "b" } },
        { text: "tidy", placement: { kind: "routed", workstream: "w1" } },
        { text: "which?", placement: { kind: "unclear", question: "", candidates: [] } },
      ],
    });

    expect(outcome.kind).toBe("acknowledged");
    expect(second_sent.map(({ text, workstream, project }) => ({ text, workstream, project }))).toEqual([
      { text: "fix the  login ", workstream: "w2", project: undefined },
      { text: "start docs", workstream: undefined, project: "b" },
    ]);
    expect(first_sent.map(({ text, workstream, parts }) => ({ text, workstream, kind: parts?.[0]?.placement.kind }))).toEqual([
      { text: "tidy", workstream: "w1", kind: undefined },
      { text: "which?", workstream: undefined, kind: "unclear" },
    ]);
    expect(first_sent.map(sent => sent.submission)).toEqual(["s1:2", "s1:3"]);
  });

  it("u6271a_reconcile_finds_a_routed_ask_in_its_projects_door", async () => {
    const first = createFakeApp();
    const second = createFakeApp();
    second.handlers["ask.list"] = () => [reply({ text: "x", submission: "s1:0" })];
    first.handlers["ask.list"] = () => [];
    const open = [{ name: "a", path: "/a" }, { name: "b", path: "/b" }];
    const routing = { app: { forProject: (path: string) => (path === "/b" ? second : first) }, open: () => open };
    const asks = createAsks(first, await connectEvents(first), undefined, routing);

    expect((await asks.reconcile("s1")).kind).toBe("acknowledged");
    expect((await asks.reconcile("s2")).kind).toBe("unknown");
  });
});
