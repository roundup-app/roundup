import { copy } from "./copy";
import { logFailure } from "./log";
import { PASTED_IMAGE_TYPES } from "./seam";
import type { App, PastedImage } from "./seam";

/** An Error whose message is already plain words for the user, so it shows as written. */
export const plainMessage = Symbol();

/** App-authored writes use the native pasteboard; editor copy retains its default selection/undo behavior. */
export const writeText = (app: Pick<App, "writeClipboardText">, text: string): Promise<void> => app.writeClipboardText(text);

/** Read the event while its data is available. Encoded event images go unchanged to U418's save seam. */
export const readPaste = async (event: Pick<ClipboardEvent, "clipboardData">): Promise<{ kind: "text"; text: string } | { kind: "image"; image: PastedImage } | { kind: "empty" }> => {
  const data = event.clipboardData;

  if (!data) throw new Error(copy.clipboardDataUnavailable);

  const text = data.getData("text/plain");

  if (text) return { kind: "text", text };

  const images = [...data.files].filter(file => file.type.startsWith("image/"));

  for (const file of images) {
    const type = PASTED_IMAGE_TYPES.find(type => type === file.type);

    if (type) return { kind: "image", image: { type, bytes: new Uint8Array(await file.arrayBuffer()) } };
  }

  if (images.length) throw new Error(copy.pasteFailedTheClipboardHoldsAnImageWhich, { cause: plainMessage });

  return { kind: "empty" };
};

/** Keep real platform causes and an available recovery action; permission-refusal advice has no producer. */
export const clipboardFailure = (verb: "copy" | "paste" | "drop", thrown: Error): string => {
  if (thrown.cause === plainMessage) return thrown.message;

  // U8004b: the raw cause (platform internals) goes to the App log, the notice names the action and one step.
  logFailure(copy.clipboardLog(verb), thrown);

  const retry = { copy: copy.clipboardCopyRetry, paste: copy.clipboardRetry, drop: copy.dropRetry }[verb];

  return copy.failed({ copy: copy.copy, paste: copy.paste, drop: copy.drop }[verb], retry);
};
