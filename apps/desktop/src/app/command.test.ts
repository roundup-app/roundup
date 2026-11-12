import { createRoot } from "solid-js";
import { describe, expect, it, vi } from "vitest";
import { RpcError } from "./seam";
import { command } from "./command";

const run = <T>(make: () => T): T => createRoot(make);

describe("command runner (U183, U184, U186)", () => {
  it("u183_a_non_error_rejection_rethrows", async () => {
    const fail = vi.fn();
    const call = run(() => command(() => Promise.reject("boom"), { fail }));

    await expect(call()).rejects.toBe("boom");
    expect(fail).not.toHaveBeenCalled();
  });

  it("u184_choose_failure_shows_failed_then_clears_on_the_next_run", async () => {
    let answer: Promise<string> = Promise.reject(new RpcError(-32602, "no such folder"));
    const call = run(() => command(() => answer));

    expect((await call()).kind).toBe("failed");
    expect(call.state()).toEqual({ kind: "failed", message: "no such folder" });

    answer = Promise.resolve("ok");
    const next = call();
    expect(call.state()).toEqual({ kind: "pending" });
    await next;
    expect(call.state()).toEqual({ kind: "idle" });
  });

  it("u186_close_keeps_the_tab_when_the_call_fails", async () => {
    const abort = Object.assign(new Error("gone"), { name: "AbortError" });
    const call = run(() => command(() => Promise.reject(abort)));

    expect((await call()).kind).toBe("aborted");
    expect(call.state()).toEqual({ kind: "idle" });
  });
});
