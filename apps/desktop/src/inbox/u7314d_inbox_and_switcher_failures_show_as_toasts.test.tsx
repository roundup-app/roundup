import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { RpcError } from "../app/seam";
import { ConnectedProjectContext } from "../state/connectedProject";
import { event } from "../testing/nodes";
import { notice, notices } from "../testing/notices";
import { ToastHost } from "../testing/toastHost";
import { mountTodos, todo } from "../todos/testHarness";
import { Inbox } from "./Inbox";
import { copy } from "./copy";

afterEach(cleanup);

const toasts = () => screen.getByRole("region", { name: "Updates" });

/** What the screen itself holds: the Toast region and what it shows are not the screen. */
const ownElements = (scope: ParentNode) => [...scope.querySelectorAll("*")].filter(element => !element.closest(".app-toasts"));

/** The elements of a screen, as nodes: the same ones in the same order whether or not a message shows. */
const same = (now: readonly Element[], before: readonly Element[]) => expect(now.map(element => before.indexOf(element))).toEqual(before.map((_, index) => index));

it("u7314d_inbox_and_switcher_failures_show_as_toasts: Inbox", async () => {
  const mounted = await mountTodos([todo(1)]);
  const view = render(() => <ConnectedProjectContext value={mounted.connected}><ToastHost><Inbox /></ToastHost></ConnectedProjectContext>);

  await within(view.container).findByText(copy.inboxEmpty);
  const original = mounted.app.handlers["todo.unread"];
  const elements = () => ownElements(view.container).filter(element => !element.matches(".overview-quiet"));
  const before = elements();
  const reads = () => mounted.app.calls.filter(call => call.method === "todo.unread").length;

  mounted.app.handlers["todo.unread"] = () => { throw new RpcError(-32003, "Cannot read work: try again"); };

  mounted.app.emit(event({ name: "todo.commented", data: { id: 1 } }));
  const shown = await waitFor(() => notice("alert"));
  expect(notices("alert")).toEqual([shown]);
  expect(toasts().contains(shown)).toBe(true);
  expect(ownElements(document).filter(line => line.matches(".message-body"))).toEqual([]);
  same(elements(), before);

  Object.assign(mounted.app.handlers, { "todo.unread": original });
  const readsBefore = reads();
  fireEvent.click(within(toasts()).getByRole("button", { name: "Retry Inbox" }));
  await waitFor(() => expect(notices("alert")).toEqual([]));
  expect(reads()).toBe(readsBefore + 1);
  same(elements(), before);

  mounted.app.handlers["todo.unread"] = () => { throw new RpcError(-32003, "Cannot read work: try again"); };

  mounted.app.emit(event({ name: "todo.commented", data: { id: 1 } }));
  await waitFor(() => notice("alert"));
  fireEvent.click(within(toasts()).getByRole("button", { name: "Dismiss" }));
  await waitFor(() => expect(notices("alert")).toEqual([]));
  same(elements(), before);
});
