import "./Textarea.css";
import { Field } from "@ark-ui/solid/field";
import { splitProps } from "solid-js";
import type { ComponentProps, JSX } from "solid-js";

/** A multi-line text field over Ark's Field.Textarea; it grows to its text, and the caller owns the value and the keys. */
export const Textarea = (props: Omit<ComponentProps<typeof Field.Textarea>, "autoresize">): JSX.Element => {
  const [local, rest] = splitProps(props, ["class"]);

  return (
    <Field.Root class="app-textarea-root">
      <Field.Textarea autoresize {...rest} class={`app-textarea ${local.class ?? ""}`} />
    </Field.Root>
  );
};
