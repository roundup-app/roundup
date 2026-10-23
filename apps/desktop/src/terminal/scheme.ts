import type { AppSeam } from "../app/seam";
import { appDark, followAppAppearance } from "../settings/preferences";
import { terminalThemeFor } from "./theme";

/** X17: tells the Daemon the window's colour scheme and the emulator's colours for it, now and on every switch, so the Daemon answers a program's colour query for every Terminal, shown or not. Resolves once the Daemon has answered the first one, or failed it with a warning (the connection's next call reports a dead Daemon), with the call that stops following the window. */
export const syncTerminalScheme = async (app: AppSeam): Promise<() => void> => {
  const send = (): Promise<null> => {
    const dark = appDark();
    const theme = terminalThemeFor(dark);

    return app.rpc("terminal.scheme", { scheme: dark ? "dark" : "light", background: theme.background, foreground: theme.foreground });
  };

  const follow = () => void send().catch(console.warn);

  await send().catch(console.warn);

  return followAppAppearance(follow);
};
