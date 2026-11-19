import { expect, it } from "vitest";
import { copy } from "./copy";
import { unknownOutcomeLine } from "./failureOf";
import { RpcError } from "./seam";

const INSTALL = "curl -fsSL https://releases.herdr.dev/core/install.sh | sh";

it("hm7589a_toast_shows_the_daemon_message", () => {
  const line = unknownOutcomeLine(new RpcError(-32603, `core_missing: herdr-core is not installed. Install it with: ${INSTALL}`));

  expect(line).toBe(`herdr-core is not installed. Install it with: ${INSTALL}`);
});

it("hm7589b_other_internal_errors_keep_the_fixed_copy", () => {
  const line = unknownOutcomeLine(new RpcError(-32603, "core_closed: herdr-core did not answer"));

  expect(line).toBe(copy.rpcFailure(-32603));
  expect(line).not.toContain("did not answer");
});
