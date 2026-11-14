import { createRoot } from "solid-js";
import * as v from "valibot";
import { afterEach, expect, it, vi } from "vitest";
import { RpcError } from "../app/seam";
import { createDraftField } from "./draftField";
import { draftStorage } from "./storage";

const destination = { surface: "pads", object: "1", recipient: null };

const schema = v.object({ text: v.string() });

const open = (project: string) => {
  const drafts = draftStorage(project);

  drafts.validate("pads", schema);

  return drafts;
};

const field = (drafts: ReturnType<typeof open>) => createRoot(() => createDraftField(drafts, destination, schema));

const settled = (drafts: ReturnType<typeof open>) => drafts.list().map(draft => [draft.value, draft.status]);

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); localStorage.clear(); });

it("u2773b_send_settles_the_revision_it_sent_and_clears_only_if_current", async () => {
  const drafts = open("a");
  const pad = field(drafts);
  pad.keep({ text: "A" }, null);
  const replies: (() => void)[] = [];
  const sending = pad.send(() => new Promise<void>(resolve => { replies.push(resolve); }));
  await vi.waitFor(() => expect(replies).toHaveLength(1));
  expect(settled(drafts)).toEqual([[{ text: "A" }, "pending"]]);
  pad.keep({ text: "B" }, null);
  replies[0]?.();

  expect(await sending).toEqual({ kind: "applied", result: undefined });
  expect(settled(drafts)).toEqual([[{ text: "B" }, "draft"]]);
  expect(pad.value()).toMatchObject({ success: true, output: { text: "B" } });
});

it("u2773b_a_refused_send_keeps_both_revisions", async () => {
  const drafts = open("b");
  const pad = field(drafts);
  pad.keep({ text: "A" }, null);
  // U3791b: only a typed refusal proves the write failed; any other throw leaves it unknown.
  const sending = pad.send(() => Promise.reject(new RpcError(-32602, "no")));
  await vi.waitFor(() => expect(drafts.list()[0]?.status).toBe("pending"));
  pad.keep({ text: "B" }, null);

  expect(await sending).toMatchObject({ kind: "refused" });
  expect(settled(drafts)).toEqual([[{ text: "A" }, "failed"], [{ text: "B" }, "draft"]]);
});

it("u2773b_no_reply_in_15_s_settles_unknown", async () => {
  vi.useFakeTimers();
  const drafts = open("c");
  const pad = field(drafts);
  pad.keep({ text: "A" }, null);
  const sending = pad.send(() => new Promise<void>(() => undefined));
  await vi.advanceTimersByTimeAsync(14_999);
  expect(drafts.list()[0]?.status).toBe("pending");
  await vi.advanceTimersByTimeAsync(1);

  expect(await sending).toEqual({ kind: "unknown" });
  expect(drafts.list()[0]?.status).toBe("unknown");
});

it("u2773a_a_caret_only_change_writes_no_revision", async () => {
  const drafts = open("d");
  const pad = field(drafts);
  pad.keep({ text: "abc" }, { start: 0, end: 0, direction: "none" });
  const [first] = drafts.list();
  const edit = vi.spyOn(drafts, "edit");
  pad.keep({ text: "abc" }, { start: 2, end: 2, direction: "none" });
  pad.keep({ text: "abc" }, { start: 2, end: 2, direction: "none" });

  expect(edit).not.toHaveBeenCalled();
  expect(drafts.list()).toEqual([{ ...first, selection: { start: 2, end: 2, direction: "none" } }]);
});

it("u2773c_a_recovered_draft_never_sends_until_save", async () => {
  const earlier = open("e");
  await earlier.edit(destination, { text: "left behind" }, null, "ordinary").retained;
  const drafts = open("e");
  const pad = field(drafts);
  const call = vi.fn(() => Promise.resolve("ok"));

  expect(pad.recovered()).toBe(true);
  expect(await pad.send(call)).toEqual({ kind: "skipped" });
  expect(call).not.toHaveBeenCalled();
  pad.save();

  expect(pad.recovered()).toBe(false);
  expect(await pad.send(call)).toEqual({ kind: "applied", result: "ok" });
  expect(drafts.list()).toEqual([]);
});

it("u2773e_a_retention_failure_keeps_the_draft_in_memory", async () => {
  const drafts = open("f");
  const pad = field(drafts);
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("full"); });
  pad.keep({ text: "kept" }, null);
  await vi.waitFor(() => expect(drafts.problem()).toMatchObject({ operation: "retain", cause: "write" }));

  expect(pad.value()).toMatchObject({ success: true, output: { text: "kept" } });
});
