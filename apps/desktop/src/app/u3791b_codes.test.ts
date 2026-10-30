import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { copy } from "./copy";
import { outcomeOf, RpcError } from "./seam";
import { clipboardFailure, readPaste } from "./clipboard";
import { pasteEvent, imageFile } from "../testing/clipboard";

const codes = [...readFileSync("../../crates/rpc/src/error.rs", "utf8").split("#[derive")[0]!.matchAll(/pub const (\w+): i64 = (-?\d+);/g)]
  .map(([, name, value]) => ({ name: name!, code: Number(value) }));

it("u3791b_every_rpc_code_has_copy", () => {
  expect(codes.length).toBeGreaterThan(0);

  for (const { name, code } of codes) {
    expect(copy.rpcFailure(code), name).not.toBe(copy.rpcFailure(1));
    expect(copy.rpcFailure(code), name).toMatch(/\S/);
  }

  expect(copy.rpcFailure(1)).toMatch(/check|try|keep/i);
});

it("u3791b_thrown_outcome_preserves_uncertainty", () => {
  const uncertain = new Set(["INTERNAL", "UNKNOWN_OUTCOME", "NOT_ACCEPTED", "NOT_ACKED"]);

  for (const { name, code } of codes) {
    for (const message of ["refused; choose again", "timeout; may have committed", "", "unsupported"]) {
      expect(outcomeOf(new RpcError(code, message)), name).toBe(uncertain.has(name) ? "unknown" : "failed");
    }
  }

  for (const thrown of [new RpcError(42, "refused"), new Error("forbidden"), { code: -32002 }, "refused", 0, null, undefined]) {
    expect(outcomeOf(thrown)).toBe("unknown");
  }
});

it.each(["opaque details", "refused; retry refresh choose"])("u3791b_copy_depends_on_codes_not_messages_clipboard_%s", async message => {
  const target = document.createElement("div");
  let reading!: ReturnType<typeof readPaste>;
  target.addEventListener("paste", event => { reading = readPaste(event); });
  pasteEvent(target, "", [imageFile("image/bmp")]);

  const failure = await reading.then(() => null, thrown => {
    if (!(thrown instanceof Error)) throw thrown;

    return thrown;
  });

  if (failure === null) throw new Error("Unsupported image unexpectedly accepted");
  failure.message = message;
  expect(clipboardFailure("paste", failure)).toBe(message);
  expect(clipboardFailure("paste", new Error(message))).not.toBe(message);
});
