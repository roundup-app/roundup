import { fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { expect, it } from "vitest";
import { copy } from "./copy";
import { answers, flowComparison, FLOW_FILES } from "./flowFixture";
import { reads } from "./moveHarness";
import { take } from "./noteHarness";
import { chooseLens, drawn, landed, moduleRow, setUpView } from "./viewHarness";

setUpView();

// U7696d: the move reader starts with the first Logic file drawn, never before. A file of its own, since the Worker is made once for a page.

it("u7696d_no_worker_starts_before_a_logic_file_is_drawn", async () => {
  const mounted = await landed(() => ({ files: FLOW_FILES }), flowComparison);

  mounted.app.handlers["agent.callPaths"] = answers();
  fireEvent.click(await screen.findByRole("radio", { name: copy.targetTree }));

  // A file drawn in the Modules lens asks nothing.
  await chooseLens(copy.lenses.modules);
  take(moduleRow("apps/a"));
  await drawn();
  expect(reads.made).toBe(0);

  // The first file drawn in Logic starts one Worker, and the next file uses it.
  await chooseLens(copy.lenses.logic);
  take(moduleRow("apps/a"));
  await waitFor(() => expect(reads.requests.length).toBeGreaterThan(0));
  expect(reads.made).toBe(1);
  take(moduleRow("crates/b"));
  await waitFor(() => expect(reads.requests.map(request => request.path)).toContain("crates/b/src/lib.rs"));
  expect(reads.made).toBe(1);
});
