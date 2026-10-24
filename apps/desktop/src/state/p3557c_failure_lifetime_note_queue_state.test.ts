import { expect, it } from "vitest";
import type { Message } from "@contracts/message/Message";
import { createFakeApp } from "../testing/fakeApp";
import { connectProject } from "./connectedProject";
import { event } from "../testing/nodes";

const note = (id: number, to = "a", over: Partial<Message> = {}): Message => ({
  id, from: { kind: "user", id: "user", parent: null }, to, kind: "note", body: `n${id}`, replyTo: null, status: "pending", reason: null, at: id, ...over,
});

const open = async (listFails = false) => {
  const app = createFakeApp();
  let failList = listFails;

  app.handlers["message.list"] = (params) => {
    if (failList) throw new Error("list refused");

    return [note(1), note(2), note(3, "b")].filter((each) => each.to === params.to);
  };

  const connected = await connectProject(app, { name: "p", path: "/p" }, () => false, () => 0);
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

  return { app, notes: connected.notes, tick, healList: () => void (failList = false) };
};

const gone = (m: Message) => event({ name: "message.dropped", data: { ...m, status: "dropped", reason: "removed" } });

it("p3557c_failure_lifetime_note_queue_state", async () => {
  const { app, notes, tick } = await open();
  const [one, two, bee] = [note(1), note(2), note(3, "b")];

  notes.load("a");
  await tick();

  // failed deletion stays actionable, keeps identity, and equal text is not the same failure
  app.handlers["message.drop"] = () => { throw new Error("refused"); };

  await notes.remove(one);
  await notes.remove(two);
  expect(notes.selected("a")).toMatchObject({ agent: "a", message: 2, cause: "refused" });
  const first = notes.selected("a")!.key;

  // dismissal changes nothing else, and a later equal-text failure is a new one
  const calls = app.calls.length;
  notes.dismiss(first);
  expect(app.calls.length).toBe(calls);
  expect(notes.rows("a").map((row) => row.message.id)).toEqual([1, 2]);
  expect(notes.selected("a")).toMatchObject({ message: 1 });
  await notes.remove(two);
  expect(notes.selected("a")!.key).not.toBe(first);
  expect(notes.failure("a")).toBe("refused");

  // an unrelated Message or Agent never clears it; an acknowledged action clears only its own
  app.handlers["message.drop"] = () => ({ ...bee, status: "dropped" });
  await notes.remove(bee);
  expect(notes.selected("a")).toMatchObject({ message: 2 });
  app.emit(gone(note(9)));
  expect(notes.selected("a")).toMatchObject({ message: 2 });
  app.handlers["message.drop"] = () => ({ ...one, status: "dropped" });
  await notes.remove(one);
  expect(notes.selected("a")).toMatchObject({ message: 2 });
  app.emit(gone(two));
  expect(notes.selected("a")).toBeNull();
  expect(notes.failure("b")).toBeNull();

  // starting a retry does not acknowledge; the acknowledged one does
  app.handlers["message.deliver"] = () => { throw new Error("no"); };

  await notes.allow(two);
  let release: (m: Message) => void = () => {};

  app.handlers["message.deliver"] = () => new Promise<Message>((resolve) => { release = resolve; });
  const retry = notes.allow(two);
  expect(notes.selected("a")).toMatchObject({ message: 2, cause: "no" });
  release(two);
  await retry;
  expect(notes.selected("a")).toBeNull();

  // list failure is isolated from item actions and recovered only by its own retry
  const other = await open(true);
  other.notes.load("a");
  await other.tick();
  expect(other.notes.selected("a")).toMatchObject({ message: null, cause: "list refused" });
  other.app.handlers["message.drop"] = () => ({ ...one, status: "dropped" });
  await other.notes.remove(one);
  other.app.emit(gone(two));
  expect(other.notes.failure("a")).toBe("list refused");
  other.healList();
  other.notes.load("a");
  await other.tick();
  expect(other.notes.failure("a")).toBeNull();
  expect(other.notes.rows("a").map((row) => row.message.id)).toEqual([1]);
});
