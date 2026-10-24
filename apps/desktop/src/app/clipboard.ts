import { copy } from "../copy";
import { PASTED_IMAGE_TYPES } from "./seam";
import type { App, PastedImage } from "./seam";

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

  if (images.length) throw new Error(copy.pasteFailedTheClipboardHoldsAnImageWhich);

  return { kind: "empty" };
};

/** Keep real platform causes and an available recovery action; permission-refusal advice has no producer. */
export const clipboardFailure = (verb: "copy" | "paste", thrown: Error): string =>
  thrown.message === copy.pasteFailedTheClipboardHoldsAnImageWhich ? thrown.message
    : copy.failed(verb === "paste" ? copy.paste : copy.copy, `${/[.!?]$/.test(thrown.message) ? thrown.message : `${thrown.message}.`} ${verb === "paste" ? copy.clipboardRetry : copy.clipboardCopyRetry}`);
