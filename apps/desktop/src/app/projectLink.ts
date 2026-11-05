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

/** The Daemon's key for the Project at `path` (the Daemon names its Project folder so): its folder name, a dash and the first 16 hex digits of the SHA-256 of the path. `path` must already be canonical; a symlinked recent path does not match. */
export const keyOfPath = async (path: string): Promise<string> => {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(path)));

  return `${path.split("/").findLast(Boolean) ?? "root"}-${Array.from(digest.slice(0, 8), byte => byte.toString(16).padStart(2, "0")).join("")}`;
};

/** U6249c1: a `roundup://` link from a surface of `app`'s Project gains that Project's key when it names none; a link that names a Project, even another, and a published link, which carries its own, stay byte-equal. */
export const inProject = async (app: AppSeam, url: string): Promise<string> => {
  const link = URL.canParse(url) ? new URL(url) : null;

  if (!link || link.protocol !== "roundup:" || link.hostname === "deliverable" || link.searchParams.has("project")) return url;

  link.searchParams.set("project", await projectKeyOf(app));

  return link.toString();
};
