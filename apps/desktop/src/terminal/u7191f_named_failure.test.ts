import { expect, it } from "vitest";
import { coreFailureText } from "./coreFailure";
import { copy } from "./copy";

it("u7191f_the_failure_line_names_the_agent_and_core_address", () => {
  const line = coreFailureText("Mode team (7) Attempt 2 Terminal 1:4 core code core_closed: core_closed: herdr-core closed");

  expect(line).toBe(`${copy.coreFailure_core_closed} (Mode team (7) Attempt 2 Terminal 1:4)`);
});
