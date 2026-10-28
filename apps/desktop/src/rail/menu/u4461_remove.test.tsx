import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { RpcError } from "../../app/seam";
import { agent, workstream } from "../../testing/nodes";
import { mountRail, railCallsTo, rowOf } from "../railFixture";

 afterEach(cleanup);

it("u4461_the_question_has_three_answers_and_remove_this_is_default", async () => {
  const { app } = await mountRail([workstream("chosen")]);
  fireEvent.contextMenu(rowOf("chosen"));
  await app.pickMenu("Remove");
  await waitFor(() => expect(app.removalQuestions).toHaveLength(1));
  expect(app.removalQuestions[0]).toMatchObject({ thisLabel: "Remove this", allLabel: "Remove all", cancelLabel: "Cancel" });
  expect(railCallsTo(app, "rail.remove")).toEqual([]);
});
