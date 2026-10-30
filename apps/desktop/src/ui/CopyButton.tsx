import { createEffect, createMemo, createSignal, mapArray, on, onCleanup, splitProps, type JSX } from "solid-js";
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
  const [local, rest] = splitProps(props, ["app", "text", "identity", "children", "onSuccess", "onFailure", "failureLabel"]);
  const feedback = createCopyFeedback();
  createEffect(on(() => [local.text, local.identity, local.app], feedback.reset));

  const write = () => {
    const text = local.text;
    const success = local.onSuccess;
    const failure = local.onFailure;
    void feedback.run(() => writeText(local.app, text), () => success?.(), failure);
  };

  return <button type="button" data-button="quiet" {...rest} onClick={write}>{feedback.copied() ? copy.copied : feedback.failed() && local.failureLabel ? local.failureLabel : local.children}</button>;
};
