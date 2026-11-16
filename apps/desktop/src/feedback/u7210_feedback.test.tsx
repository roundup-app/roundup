import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import type { Check } from "@contracts/feedback/Check";
import type { Filed } from "@contracts/feedback/Filed";
import { RpcError, type FeedbackReport } from "../app/seam";
import { captureActions } from "../keys/registry";
import {
  ConnectedProjectContext,
  connectProject,
} from "../state/connectedProject";
import { createFakeApp } from "../testing/fakeApp";
import type { Candidate } from "../toasts/queue";
import { copy } from "./copy";
import { versionsText } from "./facts";
import { Feedback } from "./Feedback";

const ISSUE = "https://github.com/roundup-app/roundup/issues/7300";

const VERSIONS = "roundup 1.2.3 (abc) · herdr-core 0.1.20 · macOS 15.1";

const report = (
  shot: string | null = "iVBOR",
  shot_error: string | null = null,
): FeedbackReport => ({
  shot,
  shot_error,
  facts: { version: "1.2.3", commit: "abc", macos: "15.1" },
});

const ready: Check = { gh: "ready", attach: true, herdrCore: "0.1.20" };

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const mount = async (
  check: Check = ready,
  capture: () => Promise<FeedbackReport> = async () => report(),
) => {
  const app = createFakeApp();
  const sends: unknown[] = [];
  const toasts: Candidate[] = [];
  let filed: () => Promise<Filed> = async () => ({ number: 7300, url: ISSUE });

  app.handlers["feedback.check"] = () => check;

  app.handlers["feedback.send"] = (params) => {
    sends.push(params);

    return filed();
  };

  app.feedbackCapture = vi.fn(capture);

  const connected = await connectProject(
    app,
    { name: "p", path: "/p" },
    () => false,
    () => 0,
  );

  render(() => (
    <ConnectedProjectContext.Provider value={connected}>
      <Feedback notify={(candidate) => toasts.push(candidate)} />
    </ConnectedProjectContext.Provider>
  ));
  await connected.rail.settled();

  return {
    app,
    sends,
    toasts,
    answer: (next: () => Promise<Filed>) => {
      filed = next;
    },
  };
};

const chord = (target: EventTarget = document.body) =>
  target.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "F",
      code: "KeyF",
      metaKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    }),
  );

const field = (): HTMLTextAreaElement => {
  const element = document.querySelector<HTMLTextAreaElement>(
    ".feedback-form textarea",
  );

  if (element === null) throw new Error("the dialog has no field");

  return element;
};

const form = () => document.querySelector(".feedback-form");

const versions = () =>
  document.querySelector(".feedback-versions")?.textContent;

const note = () => document.querySelector(".feedback-note")?.textContent;

const submitOrNull = () =>
  document.querySelector<HTMLButtonElement>(
    '.feedback-form button[type="submit"]',
  );

const submit = (): HTMLButtonElement => {
  const button = submitOrNull();

  if (button === null) throw new Error("the dialog has no Send button");

  return button;
};

const open = async () => {
  chord();
  await waitFor(() => expect(document.activeElement).toBe(field()));
};

const type = (value: string) => fireEvent.input(field(), { target: { value } });

const press = async (text = "the Rail jumps") => {
  type(text);
  await waitFor(() => expect(submit().disabled).toBe(false));
  fireEvent.click(submit());
};

it("u7210a_the_command_list_offers_send_feedback", async () => {
  const { app } = await mount();

  const row = captureActions(document.activeElement).find(
    (action) => action.name === "feedback.open",
  );

  expect(row).toMatchObject({ label: "Send feedback…", searchable: true });
  row?.run();
  await waitFor(() => expect(form()).not.toBeNull());
  expect(app.feedbackCapture).toHaveBeenCalledTimes(1);
});

it("u7210a_the_menu_event_opens_the_dialog", async () => {
  await mount();

  window.dispatchEvent(new Event("open-feedback"));
  await waitFor(() => expect(document.activeElement).toBe(field()));
});

it("u7210a_the_chord_opens_the_dialog_and_a_terminal_does_not_receive_it", async () => {
  await mount();

  const terminal = document.body.appendChild(
    document.createElement("textarea"),
  );

  const reached: string[] = [];

  terminal.className = "xterm-helper-textarea";
  // listener-owner: the test's Terminal stand-in, which cleanup removes with the document body.
  terminal.addEventListener("keydown", (event) => reached.push(event.code));
  terminal.focus();
  expect(chord(terminal)).toBe(false);
  await waitFor(() => expect(form()).not.toBeNull());
  expect(reached).toEqual([]);
});

it("u7210a_a_second_request_opens_nothing_more", async () => {
  let resolve!: (value: FeedbackReport) => void;

  const { app } = await mount(
    ready,
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );

  chord();
  window.dispatchEvent(new Event("open-feedback"));
  resolve(report());
  await waitFor(() => expect(form()).not.toBeNull());
  chord(field());
  window.dispatchEvent(new Event("open-feedback"));
  expect(app.feedbackCapture).toHaveBeenCalledTimes(1);
  expect(document.querySelectorAll(".feedback-form")).toHaveLength(1);
});

it("u7210b_the_dialog_shows_the_field_the_checkbox_the_versions_and_two_buttons", async () => {
  await mount();
  await open();
  expect(screen.getByRole("textbox", { name: copy.line })).toBe(field());
  expect(screen.getByRole("checkbox", { name: copy.attach })).toHaveProperty(
    "checked",
    true,
  );
  await waitFor(() =>
    expect(versions()).toBe(versionsText(report().facts, ready.herdrCore)),
  );
  expect(
    screen.getAllByRole("button").map((button) => button.textContent),
  ).toEqual([copy.close, copy.send]);
});

it("u7210b_send_waits_for_text", async () => {
  await mount();
  await open();
  await waitFor(() => expect(submit().textContent).toBe(copy.send));
  expect(submit().disabled).toBe(true);
  type("  \n ");
  expect(submit().disabled).toBe(true);
  type("the Rail jumps");
  expect(submit().disabled).toBe(false);
});

it("u7210b_escape_and_cancel_close_and_restore_focus", async () => {
  for (const close of [
    () => fireEvent.keyDown(field(), { key: "Escape", code: "Escape" }),
    () => fireEvent.click(screen.getByRole("button", { name: copy.close })),
  ]) {
    await mount();
    const before = document.body.appendChild(document.createElement("button"));

    before.focus();
    chord(before);
    await waitFor(() => expect(document.activeElement).toBe(field()));
    type("discarded");
    close();
    await waitFor(() => expect(form()).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(before));
    chord(before);
    await waitFor(() => expect(field().value).toBe(""));
    cleanup();
    before.remove();
  }
});

it("u7210c_send_closes_the_dialog_and_the_notification_opens_the_issue", async () => {
  const { app, sends, toasts } = await mount();

  await open();
  await press();
  await waitFor(() => expect(form()).toBeNull());
  expect(sends).toEqual([
    { text: "the Rail jumps", versions: VERSIONS, shot: "iVBOR" },
  ]);
  expect(toasts).toHaveLength(1);
  expect(toasts[0]?.name).toContain("#7300");
  await expect(toasts[0]?.open("pointer")).resolves.toBeNull();
  expect(app.openedTargets).toEqual([{ kind: "url", url: ISSUE }]);
});

it("u7210c_a_failed_send_keeps_the_dialog_with_the_error_and_the_text", async () => {
  const { answer, sends, toasts } = await mount();
  const failure = new RpcError(-32603, "gh: HTTP 401: Bad credentials");

  answer(async () => {
    throw failure;
  });
  await open();
  fireEvent.click(screen.getByRole("checkbox", { name: copy.attach }));
  await press();
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toBe(failure.message),
  );
  expect(field().value).toBe("the Rail jumps");
  expect(screen.getByRole("checkbox")).toHaveProperty("checked", false);
  expect(submit().disabled).toBe(false);
  expect(toasts).toHaveLength(0);
  expect(sends).toHaveLength(1);
});

it("u7210c_the_app_stays_usable_while_it_files", async () => {
  const { answer, toasts } = await mount();
  let finish!: (issue: Filed) => void;

  answer(
    () =>
      new Promise((done) => {
        finish = done;
      }),
  );
  await open();
  await press();
  expect(submit().disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: copy.close }));
  await waitFor(() => expect(form()).toBeNull());
  expect(toasts).toHaveLength(0);
  finish({ number: 7300, url: ISSUE });
  await waitFor(() => expect(toasts).toHaveLength(1));
});

it("u7210d_the_shot_is_requested_before_the_dialog_mounts", async () => {
  let resolve!: (value: FeedbackReport) => void;

  const { app } = await mount(
    ready,
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );

  chord();
  expect(app.feedbackCapture).toHaveBeenCalledTimes(1);
  expect(form()).toBeNull();
  resolve(report());
  await waitFor(() => expect(form()).not.toBeNull());
});

it("u7210d_a_failed_capture_opens_the_dialog_without_a_shot", async () => {
  const { sends } = await mount(ready, async () => report(null, "refused"));

  await open();
  expect(screen.queryByRole("checkbox")).toBeNull();
  expect(note()).toBe(copy.noShot("refused"));
  await press();
  await waitFor(() => expect(sends).toHaveLength(1));
  expect(sends[0]).not.toHaveProperty("shot");
});

it("u7210d_the_checkbox_off_sends_no_shot", async () => {
  const { sends } = await mount();

  await open();
  fireEvent.click(screen.getByRole("checkbox", { name: copy.attach }));
  await press();
  await waitFor(() => expect(sends).toHaveLength(1));
  expect(sends[0]).not.toHaveProperty("shot");
});

it("u7210d_an_older_gh_says_so_and_sends_no_shot", async () => {
  const { sends } = await mount({ gh: "ready", attach: false });

  await open();
  await waitFor(() => expect(note()).toBe(copy.oldGh));
  expect(screen.queryByRole("checkbox")).toBeNull();
  await press();
  await waitFor(() => expect(sends).toHaveLength(1));
  expect(sends[0]).not.toHaveProperty("shot");
});

it("u7210e_without_gh_the_dialog_says_so_and_copies_the_text_and_versions", async () => {
  const { app, sends } = await mount({ gh: "missing", attach: false });

  await open();
  await waitFor(() => expect(note()).toBe(copy.noGh));
  expect(submitOrNull()).toBeNull();
  type("the Rail jumps");
  fireEvent.click(screen.getByRole("button", { name: copy.copy }));
  await waitFor(() =>
    expect(app.clipboardWrites).toEqual([
      "the Rail jumps\n\nroundup 1.2.3 (abc) · macOS 15.1\n",
    ]),
  );
  expect(sends).toEqual([]);
});

it("u7210e_signed_out_says_so", async () => {
  await mount({ gh: "signed-out", attach: true });

  await open();
  await waitFor(() => expect(note()).toBe(copy.signedOut));
  expect(submitOrNull()).toBeNull();
  expect(screen.getByRole("button", { name: copy.copy })).toBeTruthy();
});
