import { expect, it, vi } from "vitest";
import { RpcError } from "../app/seam";
import { railCommand } from "../rail/railCommands";
import { createItemFailure } from "../state/itemFailure";
import { coreFailureText } from "../coreFailure";

it("u7191f_the_failure_line_names_the_agent_and_core_address", () => {
  const line = coreFailureText("Mode team (7) Attempt 2 Terminal 1:4 core code core_closed: core_closed: herdr-core closed");

  expect(line).toBe("The Terminal connection was lost — team, Terminal 1:4.");
});

it("u7191f_a_rail_command_failure_shows_the_fixed_copy", async () => {
  const commandFailure = createItemFailure(() => true);

  await railCommand(
    { refresh: vi.fn(), commandFailure },
    { call: () => Promise.reject(new RpcError(-32002, "Mode team (7) Attempt 2 Terminal 1:4 core code core_closed: core_closed: herdr-core closed")) },
  );

  expect(commandFailure.message()).toBe("The Terminal connection was lost — team, Terminal 1:4.");
});
