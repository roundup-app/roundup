import { createEffect, createMemo, createSignal, mapArray, omit, onCleanup } from "solid-js";
import type { JSX } from "@solidjs/web";
import { debounce } from "@solid-primitives/scheduled";
import { writeText } from "../app/clipboard";
import type { App } from "../app/seam";
import { copy } from "./copy";
import { BusyButton } from "./BusyButton";
import { Icon } from "../ink/Icon";

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
export const CopyButton = (props: Omit<JSX.ButtonHTMLAttributes<HTMLButtonElement>, "onClick" | "type" | "disabled"> & {
  /** The button kind; quiet unless named, `null` for a surface that styles it. */
  "data-button"?: "primary" | "quiet" | "icon" | null;
  app: Pick<App, "writeClipboardText">;
  text: string;
  identity?: unknown;
  failureLabel?: string;
  onSuccess?: (() => void) | undefined;
  onFailure: (error: Error) => void;
}) => {
  const rest = omit(props, "app", "text", "identity", "children", "onSuccess", "onFailure", "failureLabel", "data-button");
  const feedback = createCopyFeedback();
  // A memo: a parent recomputing the same text must not clear the copy feedback early.
  const copying = createMemo(() => [props.text, props.identity, props.app] as const, { equals: (before, after) => before.every((part, index) => part === after[index]) });

  createEffect(copying, feedback.reset);

  const write = () => {
    const app = props.app;
    const text = props.text;
    const success = props.onSuccess;
    const failure = props.onFailure;

    return feedback.run(() => writeText(app, text), () => success?.(), failure);
  };

  // U7310e: an icon button shows a check, and is named Copied, once its write lands.
  const copiedIcon = () => props["data-button"] === "icon" && feedback.copied();

  return <BusyButton {...rest} aria-label={copiedIcon() ? copy.copied : props["aria-label"]} kind={props["data-button"] === undefined ? "quiet" : props["data-button"]} busyLabel={copy.copying} onClick={write}>{copiedIcon() ? <Icon name="check" /> : feedback.copied() ? copy.copied : feedback.failed() && props.failureLabel ? props.failureLabel : props.children}</BusyButton>;
};
