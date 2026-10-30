import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import { createSignal, Show } from "solid-js";
import { createFakeApp } from "../testing/fakeApp";
import { CopyButton } from "./CopyButton";
import { copy } from "./copy";
import { withStylesheets } from "../testing/contrast";

afterEach(() => { cleanup(); vi.useRealTimers(); });

it("u3010c_copy_feedback_belongs_to_the_acknowledged_control", () => withStylesheets(async () => {
  vi.useFakeTimers();
  const app = createFakeApp();
  const failed = vi.fn();
  let acknowledge: (() => void) | undefined;
  app.writeClipboardText = () => new Promise<void>(resolve => { acknowledge = resolve; });
  render(() => <><CopyButton app={app} text="first" onFailure={failed}>First</CopyButton><CopyButton app={app} text="second" onFailure={failed}>Second</CopyButton></>);
  const first = screen.getByRole("button", { name: "First" });
  const second = screen.getByRole("button", { name: "Second" });
  fireEvent.click(first);
  expect(screen.getByRole("button", { name: "First" })).toBe(first);
  acknowledge!();
  await Promise.resolve();
  expect(screen.getByRole("button", { name: copy.copied })).toBe(first);
  expect(screen.getByRole("button", { name: "Second" })).toBe(second);
  await vi.advanceTimersByTimeAsync(1000);
  fireEvent.click(first);
  acknowledge!();
  await Promise.resolve();
  await vi.advanceTimersByTimeAsync(600);
  expect(screen.getByRole("button", { name: copy.copied })).toBe(first);

  app.writeClipboardText = async () => { throw new Error("refused"); };

  fireEvent.click(first);
  await Promise.resolve();
  expect(screen.getByRole("button", { name: "First" })).toBe(first);
  expect(failed).toHaveBeenCalledOnce();
  await vi.runAllTimersAsync();
  expect(failed).toHaveBeenCalledOnce();
}));

it("u3010c_copy_disposal_cancels_feedback", () => withStylesheets(async () => {
  vi.useFakeTimers();
  const app = createFakeApp();
  const failed = vi.fn();
  let reject: ((error: Error) => void) | undefined;
  app.writeClipboardText = () => new Promise<void>((_resolve, refusal) => { reject = refusal; });
  const [visible, setVisible] = createSignal(true);
  render(() => <Show when={visible()} fallback={<button>Replacement</button>}><CopyButton app={app} text="old" onFailure={failed}>Old</CopyButton></Show>);
  fireEvent.click(screen.getByRole("button", { name: "Old" }));
  setVisible(false);
  reject!(new Error("late refusal"));
  await Promise.resolve();
  await vi.runAllTimersAsync();
  expect(failed).not.toHaveBeenCalled();
  expect(screen.getAllByRole("button")).toHaveLength(1);
}));

it("u3010c_newer_copy_failure_survives_an_older_acknowledgement", async () => {
  const app = createFakeApp();
  const failed = vi.fn();
  let acknowledge: (() => void) | undefined;
  app.writeClipboardText = () => new Promise<void>(resolve => { acknowledge = resolve; });
  render(() => <CopyButton app={app} text="retained" onFailure={failed}>Original</CopyButton>);
  const control = screen.getByRole("button", { name: "Original" });
  fireEvent.click(control);
  app.writeClipboardText = async () => { throw new Error("latest refusal"); };

  fireEvent.click(control);
  await Promise.resolve();
  acknowledge!();
  await Promise.resolve();
  expect(failed).toHaveBeenCalledOnce();
  expect(screen.getByRole("button", { name: "Original" })).toBe(control);
});

it("u3010c_a_replacement_revision_does_not_inherit_copy_feedback", async () => {
  const app = createFakeApp();
  const failed = vi.fn();
  let reject: ((error: Error) => void) | undefined;
  app.writeClipboardText = () => new Promise<void>((_resolve, refusal) => { reject = refusal; });
  const [identity, setIdentity] = createSignal("original-revision");
  render(() => <CopyButton app={app} text="unchanged text" identity={identity()} onFailure={failed}>Copy revision</CopyButton>);
  fireEvent.click(screen.getByRole("button", { name: "Copy revision" }));
  setIdentity("new-revision");
  reject!(new Error("old revision failed"));
  await Promise.resolve();
  expect(failed).not.toHaveBeenCalled();
});
