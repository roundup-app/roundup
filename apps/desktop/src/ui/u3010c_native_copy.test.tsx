import { cleanup, fireEvent, screen, within } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { mountTodos, todo } from "../todos/testHarness";
import { copy } from "./copy";
import { withStylesheets } from "../testing/contrast";

afterEach(cleanup);

it("u3010c_native_copy_waits_for_dismissal_and_acknowledgement_on_its_row", () => withStylesheets(async () => {
  const { app } = await mountTodos([todo(5, { title: "chosen" }), todo(6, { title: "other" })], true);
  const chosen = (await screen.findByText("chosen")).closest<HTMLElement>("[data-todo]")!;
  const other = (await screen.findByText("other")).closest<HTMLElement>("[data-todo]")!;
  let acknowledge: (() => void) | undefined;
  app.clipboardWrite = () => new Promise<void>(resolve => { acknowledge = resolve; });

  fireEvent.contextMenu(chosen);
  expect(acknowledge).toBeUndefined();
  await app.pickMenu("Copy link");
  expect(acknowledge).toBeTypeOf("function");
  expect(within(chosen).queryByText(copy.copied)).toBeNull();
  acknowledge!();
  await Promise.resolve();
  expect(await within(chosen).findByText(copy.copied)).toBeTruthy();
  expect(within(other).queryByText(copy.copied)).toBeNull();
  expect(app.shownMenus).toHaveLength(1);
}));
