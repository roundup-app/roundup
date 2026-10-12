import { createSignal, Show } from "solid-js";

type Editing = { from: string; text: string };

/**
 * Double-click edits; leaving the field commits once, and only when the text differs from what the field started
 * with, so another Actor's change made meanwhile is never written back. A failed commit reopens the field with
 * the typed text.
 */
export const EditableText = (props: {
  value: string;
  multiline: boolean;
  name: "title" | "body";
  /** Resolves with the failure message, or `null` when the commit went through. */
  commit: (text: string) => Promise<string | null>;
}) => {
  const [editing, setEditing] = createSignal<Editing | null>(null);

  const startWith = (text: string) => {
    if (shown) setWidth(shown.getBoundingClientRect().width);

    setEditing({ from: props.value, text });
  };

  let shown: HTMLParagraphElement | undefined;
  // The shown text's width, kept so the field wraps on the same lines (U445).
  const [width, setWidth] = createSignal(0);

  const fit = (element: HTMLTextAreaElement) => {
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
  };

  const field = (started: Editing) => (element: HTMLTextAreaElement) => {
    element.value = started.text;
    fit(element);
    queueMicrotask(() => element.focus());

    element.addEventListener("input", () => {
      if (!props.multiline && element.value.includes("\n")) element.value = element.value.replace(/\r?\n/g, " ");

      fit(element);
    });

    // Removing a focused field can fire a second blur in a webview.
    let left = false;

    element.addEventListener("blur", () => {
      if (left) return;

      left = true;
      setEditing(null);

      if (element.value === started.from) return;

      void props.commit(element.value).then((failure) => {
        if (failure !== null) startWith(element.value);
      });
    });
  };

  return (
    <Show
      when={editing()}
      fallback={
        <p
          ref={shown}
          tabIndex={0}
          onDblClick={() => startWith(props.value)}
          onKeyDown={(key) => {
            if (key.key === "Enter") startWith(props.value);
          }}
          style={{ "white-space": "pre-wrap", "min-height": "1.4em" }}
        >
          <Show when={props.value !== ""} fallback={<span class="light">{`no ${props.name}`}</span>}>
            {props.value}
          </Show>
        </p>
      }
      keyed
    >
      {(started) => (
        <textarea
          ref={field(started)}
          aria-label={props.name}
          rows={1}
          onKeyDown={(key) => {
            if (!props.multiline && key.key === "Enter") {
              key.preventDefault();
              key.currentTarget.blur();
            }
          }}
          style={{
            display: "block",
            font: "inherit",
            "letter-spacing": "inherit",
            "line-height": "inherit",
            color: "inherit",
            "text-align": "inherit",
            "white-space": "pre-wrap",
            "overflow-wrap": "inherit",
            padding: "0",
            margin: "0",
            border: "0",
            "box-sizing": "content-box",
            width: width() > 0 ? `${width()}px` : "100%",
            "min-height": "1.4em",
            resize: "none",
            overflow: "hidden",
            outline: "none",
            background: "var(--hover)",
            "caret-color": "var(--accent)",
          }}
        />
      )}
    </Show>
  );
};
