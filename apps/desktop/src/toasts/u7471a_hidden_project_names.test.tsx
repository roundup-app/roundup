import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { createSignal, flush } from "solid-js";
import { afterEach, expect, it } from "vitest";
import { createMessageToast, projectMessageQueue, ToastQueueContext } from "../ink/messageToast";
import { createToastQueue } from "./queue";
import { Toasts } from "./Toasts";

afterEach(cleanup);

it("u7471a_a_hidden_project_failure_names_its_project", () => {
  const queue = createToastQueue(() => true, () => {});
  const [shown, setShown] = createSignal("notes-app");
  const [hiddenFailure, setHiddenFailure] = createSignal<string | null>(null);

  render(() => {
    createMessageToast({ started: true, get message() { return hiddenFailure(); }, dismiss: () => setHiddenFailure(null) }, projectMessageQueue(queue, "notes-app", () => shown() === "notes-app"));

    return (
    <ToastQueueContext value={queue}>
      <Toasts queue={queue} />
    </ToastQueueContext>
    );
  });

  const alerts = () => screen.queryAllByRole("alert").filter(node => !node.hasAttribute("data-ui-sdk-announcer"));

  setShown("meta-harness");
  setHiddenFailure("Terminal stopped: exit 1");
  flush();
  expect(alerts()).toHaveLength(1);
  screen.getByRole("alert", { name: /^notes-app · Terminal stopped: exit 1$/ });

  // Switching keeps the showing toast's text.
  setShown("notes-app");
  flush();
  screen.getByRole("alert", { name: /^notes-app · Terminal stopped: exit 1$/ });
  fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
  flush();
  expect(alerts()).toHaveLength(0);

  // notes-app is shown now: its failure carries no name.
  setHiddenFailure("Terminal stopped: exit 3");
  flush();
  expect(alerts()).toHaveLength(1);
  screen.getByRole("alert", { name: /^Terminal stopped: exit 3$/ });
});
