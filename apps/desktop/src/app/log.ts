import { writeAppLog } from "./tauri";

const ERROR_LEVEL = 5;

/** Where the App log lines go; a webview without the plugin logs to its console. */
export const appLog = {
  write: (message: string): void => {
    writeAppLog(ERROR_LEVEL, message).catch(() => console.error(message));
  },
};

/** U8004a: the App log (`tauri-plugin-log`) takes the raw cause of a failure the user need not see. */
export const logFailure = (what: string, cause: unknown): void => {
  appLog.write(`${what}: ${cause instanceof Error ? cause.message : String(cause)}`);
};
