import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import { createSignal, Show } from "solid-js";
import { createFakeApp } from "../testing/fakeApp";
import { CopyButton } from "./CopyButton";

afterEach(() => { cleanup(); vi.useRealTimers(); });

it("u3010c_copy_feedback_belongs_to_the_acknowledged_control", async () => {
  vi.useFakeTimers();
  const app = createFakeApp();
  const failed = vi.fn();
  let acknowledge: (() => void) | undefined;
  app.writeClipboardText = () => new Promise<void>(resolve => { acknowledge = resolve; });
  render(() => <><CopyButton app={app} text="first" onFailure={failed}>First</CopyButton><CopyButton app={app} text="second" onFailure={failed}>Second</CopyButton></>);
  const first = screen.getByRole("button", { name: "First" });
  const second = screen.getByRole("button", { name: "Second" });
  fireEvent.click(first);
  expect(first.textContent === second.textContent).toBe(false);
  acknowledge!();
  await Promise.resolve();
  const acknowledged = first.textContent;
  expect(acknowledged).not.toBe("First");
  expect(second.textContent).toBe("Second");
  await vi.advanceTimersByTimeAsync(1000);
  fireEvent.click(first);
  acknowledge!();
  await Promise.resolve();
  await vi.advanceTimersByTimeAsync(600);
  expect(first.textContent).toBe(acknowledged);
  app.writeClipboardText = async () => { throw new Error("refused"); };
  fireEvent.click(first);
  await Promise.resolve();
  expect(first.textContent).toBe("First");
  expect(failed).toHaveBeenCalledOnce();
  await vi.runAllTimersAsync();
  expect(failed).toHaveBeenCalledOnce();
});

it("u3010c_copy_disposal_cancels_feedback", async () => {
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
  expect(screen.getByRole("button", { name: "Replacement" })).toBeTruthy();
});
