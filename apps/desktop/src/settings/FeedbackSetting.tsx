import { createSignal } from "solid-js";
import { Field } from "../ui/Field";
import { appSettings, saveAppSettings } from "./preferences";
import { copy } from "./copy";
import { validIssueUrl } from "../feedback/target";

/** FB6: the Feedback Issue's URL. A value saves when it is empty or an Issue URL; any other stays in the field, marked invalid. */
export const FeedbackSetting = (props: { onFailure: (message: string | null) => void }) => {
  const [text, setText] = createSignal(appSettings().feedbackIssue);
  const invalid = () => text().trim() !== "" && !validIssueUrl(text());

  const commit = async () => {
    if (invalid()) return;
    props.onFailure(await saveAppSettings({ feedbackIssue: text().trim() }));
  };

  return <Field.Root class="settings-field settings-field-stacked" invalid={invalid()}>
    <Field.Label>{copy.feedbackIssue}</Field.Label>
    <Field.Input value={text()} spellcheck={false} autocorrect="off" autocapitalize="off" onInput={event => setText(event.currentTarget.value)} onBlur={() => void commit()}
      onKeyDown={event => { if (event.key === "Enter" && !event.isComposing) void commit(); }} />
    <Field.HelperText>{copy.feedbackIssueHint}</Field.HelperText>
    <Field.ErrorText>{copy.feedbackIssueInvalid}</Field.ErrorText>
  </Field.Root>;
};
