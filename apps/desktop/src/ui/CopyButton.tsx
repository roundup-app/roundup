import { createEffect, createMemo, createSignal, mapArray, omit, onCleanup } from "solid-js";
import type { JSX } from "@solidjs/web";
import { debounce } from "@solid-primitives/scheduled";
import { writeText } from "../app/clipboard";
import type { App } from "../app/seam";
import { copy } from "./copy";

/** Clipboard feedback belongs to one mounted control and the latest acknowledged attempt. */
export const createCopyFeedback = () => {
  const [status, setStatus] = createSignal<"copied" | "failed" | null>(null);
  let revision = 0;
  let disposed = false;
  let cancelDeadline = () => {};

  const reset = () => { revision++; cancelDeadline(); setStatus(null); };

  const expire = () => {
    const duration = getComputedStyle(document.documentElement).getPropertyValue("--duration-copy").trim();
    const clear = debounce(() => { setStatus(null); }, parseFloat(duration) * (duration.endsWith("ms") ? 1 : 1000));
    cancelDeadline = clear.clear;
    clear();
  };

  onCleanup(() => { disposed = true; reset(); });

  return {
    copied: () => status() === "copied",
    failed: () => status() === "failed",
    reset,
    run: async (write: () => Promise<void>, success: () => void, failure: (error: Error) => void) => {
      if (disposed) return;

      reset();
      const current = revision;

      try {
        await write();

        if (disposed || revision !== current) return;

        setStatus("copied");
        expire();
        success();
      } catch (error) {
        if (!disposed && revision === current) {
          setStatus("failed");
          expire();
          failure(error instanceof Error ? error : new Error(String(error)));
        }
      }
    },
  };
};

/** Native menu feedback is retained by item identity, using Solid's keyed owner cleanup. */
export const createCopyLabels = <T extends string | number>(ids: () => readonly T[]) => {
  const entries = mapArray(ids, id => [id, createCopyFeedback()] as const);

  return createMemo(() => new Map(entries()));
};

/** The existing native button owns activation; the App seam owns the clipboard write. */
export const CopyButton = (props: Omit<JSX.ButtonHTMLAttributes<HTMLButtonElement>, "onClick"> & {
  app: Pick<App, "writeClipboardText">;
  text: string;
  identity?: unknown;
  failureLabel?: string;
  onSuccess?: (() => void) | undefined;
  onFailure: (error: Error) => void;
}) => {
  const rest = omit(props, "app", "text", "identity", "children", "onSuccess", "onFailure", "failureLabel");
  const feedback = createCopyFeedback();
  // A memo: a parent recomputing the same text must not clear the copy feedback early.
  const copying = createMemo(() => [props.text, props.identity, props.app] as const, { equals: (before, after) => before.every((part, index) => part === after[index]) });

  createEffect(copying, feedback.reset);

  const write = () => {
    const app = props.app;
    const text = props.text;
    const success = props.onSuccess;
    const failure = props.onFailure;
    void feedback.run(() => writeText(app, text), () => success?.(), failure);
  };

  return <button type="button" data-button="quiet" {...rest} onClick={write}>{feedback.copied() ? copy.copied : feedback.failed() && props.failureLabel ? props.failureLabel : props.children}</button>;
};
