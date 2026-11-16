import "./Field.css";
import { Field as FieldRoot, FieldDescription, FieldError, FieldLabel } from "@ui-sdk/solid/field";
import { Input } from "@ui-sdk/solid/input";
import { Textarea } from "@ui-sdk/solid/textarea";

/** Shared labelled fields retain ui-sdk association and validation semantics. */
export const Field = { Root: FieldRoot, Label: FieldLabel, Input, Textarea, HelperText: FieldDescription, ErrorText: FieldError };
