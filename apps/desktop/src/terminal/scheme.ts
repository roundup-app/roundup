import type { AppSeam } from "../app/seam";
import { appDark, followAppAppearance } from "../settings/preferences";
import { copy } from "./copy";
import { terminalThemeFor } from "./theme";

/** X17: tells the Daemon the window's colour scheme and the emulator's colours for it, now and on every switch, so the Daemon answers a program's colour query for every Terminal, shown or not. A failed push is logged, not shown (U6249b); ending the connection disposes the appearance subscription. */
export const syncTerminalScheme = async (app: AppSeam) => {
  let ended = false;
  let latest = 0;

  const send = async (): Promise<void> => {
    const mine = ++latest;
    const dark = appDark();
    const theme = terminalThemeFor();

    try {
      await app.rpc("terminal.scheme", { scheme: dark ? "dark" : "light", background: theme.background, foreground: theme.foreground });
    } catch (error) {
      // U6249b: a command to the Daemon is not replayed, and a colour that missed is cosmetic: the next switch sends again.
      if (!ended && mine === latest) console.warn(copy.terminalSchemeNotSent(error instanceof Error ? error.message : String(error)));
    }
  };

  await send();
  const stop = followAppAppearance(() => { void send(); });

  return { stop: () => { ended = true; stop(); } };
};
