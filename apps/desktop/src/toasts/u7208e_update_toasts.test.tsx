import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@solidjs/testing-library";
import { onCleanup } from "solid-js";
import { afterEach, beforeEach, expect, it } from "vitest";
import type { UpdateFacts } from "../app/seam";
import { createUpdates } from "../state/updates";
import { useBrowserStorage } from "../state/storage";
import { createFakeApp } from "../testing/fakeApp";
import { createToastQueue, type Candidate } from "./queue";
import { Toasts } from "./Toasts";
import { copy } from "./copy";
import { copy as sharedCopy } from "../sharedCopy";
import { watchUpdates } from "./updates";

beforeEach(() => {
  window.localStorage.clear();
  useBrowserStorage(window.localStorage);
});

afterEach(cleanup);

const BOTH: UpdateFacts = {
  roundup: { version: "0.4.0", ready: "0.5.0" },
  core: { version: "0.1.21", ready: "0.1.22" },
};

const NONE: UpdateFacts = {
  roundup: { version: "0.5.0", ready: null },
  core: { version: "0.1.22", ready: null },
};

/** What a Toast says of one ready version. */
const said = (program: string, version: string) =>
  `${copy.updateName(program, version)} ${copy.updateReady}`;

/** One launch: the facts `app` holds raise Toasts; `shown` collects each time a card shows Settings on Updates. */
const launch = (app = createFakeApp()) => {
  const notified: Candidate[] = [];
  const shown: string[] = [];
  const sounds: number[] = [];

  render(() => {
    const queue = createToastQueue(
      () => true,
      () => sounds.push(Date.now()),
    );

    const updates = createUpdates(app);

    onCleanup(updates.onShow(() => shown.push("updates")));
    watchUpdates(updates, (candidate) => {
      notified.push(candidate);
      queue.notify(candidate);
    });

    return <Toasts queue={queue} />;
  });

  return {
    notified,
    shown,
    sounds,
    names: () =>
      notified.map((candidate) => `${candidate.name} ${candidate.line}`),
  };
};

it("u7208e_each_new_version_raises_one_toast_that_opens_updates", async () => {
  const app = createFakeApp();

  app.updateFacts = BOTH;

  const { notified, shown, sounds, names } = launch(app);

  await waitFor(() =>
    expect(names()).toEqual([
      said(sharedCopy.roundup, "0.5.0"),
      said(sharedCopy.herdrCore, "0.1.22"),
    ]),
  );
  expect(sounds).toEqual([]);

  app.emitUpdates(BOTH);
  app.emitUpdates(NONE);
  expect(notified).toHaveLength(2);

  app.emitUpdates({ ...BOTH, roundup: { version: "0.4.0", ready: "0.6.0" } });
  await waitFor(() =>
    expect(names().at(-1)).toBe(said(sharedCopy.roundup, "0.6.0")),
  );
  expect(notified).toHaveLength(3);

  fireEvent.click(
    await screen.findByText(copy.updateName(sharedCopy.roundup, "0.6.0")),
  );
  await waitFor(() => expect(shown).toEqual(["updates"]));
});

it("u7208e_a_told_version_stays_told_across_looks_and_launches", async () => {
  const app = createFakeApp();

  app.updateFacts = BOTH;

  const first = launch(app);

  await waitFor(() => expect(first.notified).toHaveLength(2));
  await waitFor(() => expect(JSON.parse(window.localStorage.getItem("roundup:updates-told") ?? "null")).toEqual({ roundup: "0.5.0", core: "0.1.22" }));
  cleanup();

  const second = launch(app);

  await Promise.resolve();
  app.emitUpdates(BOTH);
  expect(second.notified).toEqual([]);

  app.emitUpdates({ ...BOTH, core: { version: "0.1.21", ready: "0.1.23" } });
  await waitFor(() =>
    expect(second.names()).toEqual([said(sharedCopy.herdrCore, "0.1.23")]),
  );
});
