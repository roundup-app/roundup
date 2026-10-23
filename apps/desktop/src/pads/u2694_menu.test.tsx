import { questionDialog, answerQuestion } from "../shelf/bulkQuestionHarness";
import { questionProbe } from "../testing/menuProbe";
import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { openShelf, padOf } from "./padsFixture";
import { USER } from "../testing/nodes";

afterEach(cleanup);

it("u2694a_each_object_builds_its_items_pad", async () => {
  const { app } = await openShelf([padOf("notes", USER, "a")]);
  const row = (await screen.findByText("notes")).closest("[data-shelf-row]")!;

  fireEvent.contextMenu(row, { clientX: 10, clientY: 10 });

  expect(app.menuLabels()).toEqual(["Send to Agent", "Copy Link", "Delete"]);
  await app.pickMenu("Delete");
  expect((await questionDialog()).message).toContain("notes");
  expect(app.calls.filter((call) => call.method === "pad.delete")).toEqual([]);
});
