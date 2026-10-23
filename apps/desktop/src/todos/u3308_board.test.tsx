import { cleanup, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { agent } from "../testing/nodes";
import { mountTodos, todo } from "./testHarness";

afterEach(cleanup);

const owner = { kind: "agent" as const, id: "a", parent: null };

it("u3308_a_free_agent_reads_free_now", async () => {
  await mountTodos([todo(1, { owner })], true, [agent("a", "idle", "", { name: "Writer" })]);
  await waitFor(() => expect(screen.getByText(/free now/)).toBeTruthy());
});
