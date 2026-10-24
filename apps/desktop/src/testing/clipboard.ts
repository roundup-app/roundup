/** jsdom lacks ClipboardEvent and DataTransfer. The production module still receives the DOM platform edge. */
export const pasteEvent = (target: Element, text = "", files: File[] = [], failure?: Error): Event => {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", { value: {
    getData: () => { if (failure) throw failure;

 return text; }, files,
  } });
  target.dispatchEvent(event);

  return event;
};

export const imageFile = (type = "image/png", bytes = Uint8Array.of(137, 80, 78, 71)): File => {
  const file = new File([bytes], "image", { type });
  Object.defineProperty(file, "arrayBuffer", { value: async () => bytes.buffer });

  return file;
};
