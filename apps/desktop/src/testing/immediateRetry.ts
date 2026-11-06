import original from "../../node_modules/p-retry/index.js";

let real = false;

/** U6249b: the backoff waits of `retryRead` are proven once, with fake timers; every other test retries without waiting. */
export const useRealBackoff = (): void => { real = true; };

/** `p-retry` for the web tests (`test.alias` in `vite.config.ts`): the same retries, with no wait between them unless the test asked for the real backoff. */
const pRetry: typeof original = (run, options) => original(run, real ? options : { ...options, minTimeout: 0, maxTimeout: 0 });

export default pRetry;
