import { copy } from "./copy";
import { BusyButton } from "../ui/BusyButton";
import { appSettings } from "./preferences";
import { resetWarnings } from "./warnings";

/** U7157d: the one row that makes every question ask again. */
export const ResetWarnings = (props: { onFailure: (failure: string | null) => void }) => (
  <div class="settings-field"><span class="settings-field-caption">{copy.resetWarningsLabel}</span><BusyButton kind="quiet" class="settings-reset-button" disabled={appSettings().suppressed.length === 0} busyLabel={copy.resetting} onClick={() => resetWarnings().then(props.onFailure)}>{copy.resetWarnings}</BusyButton></div>
);
