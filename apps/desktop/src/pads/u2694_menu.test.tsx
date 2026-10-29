import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { openShelf, padOf } from "./padsFixture";
import { USER } from "../testing/nodes";

afterEach(cleanup);

it("u2694a_each_object_builds_its_items_pad", async () => {
  const { app } = await openShelf([padOf("notes", USER, "a")]);
  const row = (await screen.findByText("notes")).closest("[data-shelf-row]")!;

  fireEvent.contextMenu(row, { clientX: 10, clientY: 10 });

  expect(app.shownMenus.at(-1)!.items.map(item => [item.id, item.group])).toEqual([["open", "0"], ["copy-link", "4"], ["rename", "5"], ["delete", "7"]]);
  await app.pickMenu("Delete");
  await waitFor(() => expect(app.calls.filter(call => call.method === "pad.delete").map(call => call.params)).toEqual([{ name: "notes", expectedIncarnation: "fixture-notes", operation: expect.any(String) }]));
});
