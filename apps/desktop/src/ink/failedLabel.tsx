import type { JSX } from "@solidjs/web";
import { copy } from "./copy";

/** What a failed action shows in a failure line: the action that failed, then the cause. */
export const failedLabel = (action: string, cause: string | null | undefined): JSX.Element => <>{copy.failed(action, "")}<span>{cause}</span></>;
