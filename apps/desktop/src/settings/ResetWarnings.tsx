import { copy } from "./copy";
import { BusyButton } from "../ui/BusyButton";
import { appSettings } from "./preferences";
import { showIconNamesAgain } from "../ui/Tip";
import { resetWarnings } from "./warnings";

/** U7157d: the one row that makes every question ask again. */
export const ResetWarnings = (props: { onFailure: (failure: string | null) => void }) => (
  <div class="settings-field"><span class="settings-field-caption">{copy.resetWarningsLabel}</span><BusyButton kind="quiet" class="settings-reset-button" disabled={appSettings().suppressed.length === 0} busyLabel={copy.resetting} onClick={() => resetWarnings().then(props.onFailure)}>{copy.resetWarnings}</BusyButton></div>
);

/** U7489c: every icon's name shows 3 more times. */
export const ShowIconNames = (props: { onFailure: (failure: string | null) => void }) => (
  <div class="settings-field"><span class="settings-field-caption">{copy.iconNamesLabel}</span><BusyButton kind="quiet" class="settings-reset-button" busyLabel={copy.resetting} onClick={() => showIconNamesAgain().then(props.onFailure)}>{copy.showIconNamesAgain}</BusyButton></div>
);
