import type { AppSeam } from "./seam";

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

/** U6249c1: a `roundup://` link from a surface of `app`'s Project gains that Project's key when it names none; a link that names a Project, even another, and a published link, which carries its own, stay byte-equal. */
export const inProject = async (app: AppSeam, url: string): Promise<string> => {
  const link = URL.canParse(url) ? new URL(url) : null;

  if (!link || link.protocol !== "roundup:" || link.hostname === "deliverable" || link.searchParams.has("project")) return url;

  link.searchParams.set("project", await projectKeyOf(app));

  return link.toString();
};
