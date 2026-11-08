import type { AppSeam } from "../app/seam";

/** The Daemon's key for its Project, read once per seam (LK1). */
const keys = new WeakMap<AppSeam, Promise<string>>();

export const projectKeyOf = (app: AppSeam): Promise<string> => {
  let key = keys.get(app);

  if (!key) {
    key = app.rpc("daemon.ping", null).then(ping => ping.projectKey);
    key.catch(() => keys.delete(app));
    keys.set(app, key);
  }

  return key;
};
