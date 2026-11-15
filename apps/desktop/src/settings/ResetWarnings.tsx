import { copy } from "./copy";
import { appSettings } from "./preferences";
import { resetWarnings } from "./warnings";

/** U7157d: the one row that makes every question ask again. */
export const ResetWarnings = (props: { onFailure: (failure: string | null) => void }) => (
  <div class="settings-field"><span class="settings-field-caption">{copy.resetWarningsLabel}</span><button class="settings-reset-button" data-button="quiet" type="button" disabled={appSettings().suppressed.length === 0} onClick={() => void resetWarnings().then(props.onFailure)}>{copy.resetWarnings}</button></div>
);
