import { cleanup } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { agent, door, USER } from "../testing/nodes";
import { message, mountThread } from "./threadFixture";

afterEach(cleanup);

describe("u190 a Scribe's Message", () => {
  it("u190_exchange_not_in_thread", async () => {
    await mountThread([door("r1", "idle", "idle", { name: "one" }), agent("s1", "needs-you", "x", { name: "scribe" })], {
      messages: [
        message(1, { from: USER, to: "r1", body: "to one" }),
        message(2, { from: USER, to: "s1", body: "shorten" }),
        message(3, { from: { kind: "agent", id: "s1", parent: null }, to: "you", body: "done" }),
      ],
    });
    const lines = () => [...document.querySelectorAll("[data-message-body], [data-message-card]")].map((line) => line.textContent ?? "").join("\n");

    await vi.waitFor(() => expect(lines()).toContain("to one"));

    expect(lines()).not.toContain("shorten");
    expect(lines()).not.toContain("done");
  });
});
