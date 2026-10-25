import { createSignal } from "solid-js";
import type { AppSeam } from "../app/seam";
import { appDark, followAppAppearance } from "../settings/preferences";
import { terminalThemeFor } from "./theme";

/** X17: tells the Daemon the window's colour scheme and the emulator's colours for it, now and on every switch, so the Daemon answers a program's colour query for every Terminal, shown or not. The Project connection owns its failure and explicit retry; ending it disposes the appearance subscription. */
export const syncTerminalScheme = async (app: AppSeam) => {
  const [failure, setFailure] = createSignal<string | null>(null);
  let ended = false;
  let latest = 0;

  const send = (): Promise<null> => {
    const dark = appDark();
    const theme = terminalThemeFor(dark);

    return app.rpc("terminal.scheme", { scheme: dark ? "dark" : "light", background: theme.background, foreground: theme.foreground });
  };

  const retry = async () => {
    const mine = ++latest;

    try {
      await send();

      if (!ended && mine === latest) setFailure(null);
    } catch (error) {
      if (!ended && mine === latest) setFailure(error instanceof Error ? error.message : String(error));
    }
  };

  await retry();
  const stop = followAppAppearance(() => { void retry(); });

  return { failure, retry, stop: () => { ended = true; stop(); } };
};
