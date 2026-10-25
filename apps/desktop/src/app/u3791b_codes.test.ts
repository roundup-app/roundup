import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { copy } from "../copy";
import { outcomeOf, RpcError } from "./seam";

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
