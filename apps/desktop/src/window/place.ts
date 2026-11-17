import { SHELF_TABS, type ShelfTab } from "../shelf/frame";
import { goToSetting } from "../settings/place";
import { projectKeyOf } from "../projectLink";
import type { App } from "../app/seam";
import type { ConnectedProject } from "../state/connectedProject";
import type { ProjectsState } from "../state/projects";
import { linkCopy } from "./copy";
import { inProject } from "./linkRoute";

/** The place a `roundup://shelf` or `roundup://settings` link names; `page` is the link's word, checked by the Settings page list. */
type Place = { kind: "shelf"; tab: ShelfTab } | { kind: "settings"; page: string; control: string | null };

type Parsed = { key: string | null; place: Place } | { failure: string };

/** PL1, PL2: whether `url` names a place; those links never reach `link.read`. */
export const isPlaceLink = (url: string) => /^roundup:\/\/(shelf|settings)\//.test(url);

const parseShelf = (link: URL, name: string, key: string | null, control: string | null): Parsed => {
  const tab = SHELF_TABS.find(({ value }) => value === name)?.value;

  if (!tab) return { failure: linkCopy.noShelfTab(name) };

  return control !== null || [...link.searchParams.keys()].some(param => param !== "project") ? { failure: linkCopy.shelfLinkForm(tab) } : { key, place: { kind: "shelf", tab } };
};

/** PL1, PL2: the Project key and the place a link names, or the one line saying why it opens nothing. */
export const parsePlace = (url: string): Parsed => {
  const link = new URL(url);
  const name = decodeURIComponent(link.pathname.replace(/^\//, ""));
  const control = link.hash === "" ? null : decodeURIComponent(link.hash.slice(1));
  const keys = link.searchParams.getAll("project");
  const key = keys.length === 1 ? keys[0] ?? null : null;

  if (link.hostname === "shelf") return parseShelf(link, name, key, control);

  return [...link.searchParams.keys()].some(param => param !== "project") ? { failure: linkCopy.settingsLinkForm(name) } : { key, place: { kind: "settings", page: name, control } };
};

/** PL1, PL2: a click on a place link selects its open Project and moves the user there; a link that cannot say where fails in one line and changes nothing. */
export const createPlaceRoute = ({ app, projects, connectionOf, openShelf, fail }: {
  app: App;
  projects: Pick<ProjectsState, "select">;
  connectionOf: (path: string) => ConnectedProject | undefined;
  openShelf: (tab: ShelfTab) => void;
  fail: (message: string | null) => void;
}) => async (surface: string | undefined, link: string) => {
  const url = surface === undefined || !URL.canParse(link) ? link : await inProject(app.forProject(surface), link);
  const parsed = URL.canParse(url) ? parsePlace(url) : { failure: linkCopy.notOpened(url, linkCopy.noOwner) };

  if ("failure" in parsed) return fail(parsed.failure);

  let connection: ConnectedProject | undefined;

  for (const project of parsed.key === null ? [] : await app.projects()) {
    if (project.running && connectionOf(project.path) && await projectKeyOf(app.forProject(project.path)).catch(() => null) === parsed.key) connection = connectionOf(project.path);
  }

  if (!connection) return fail(parsed.key === null ? linkCopy.placeNoProject : linkCopy.placeProject(parsed.key));

  projects.select(connection.project.path);
  connection.settingsView.close(false);

  if (parsed.place.kind === "shelf") {
    openShelf(parsed.place.tab);
    fail(null);
  } else fail(goToSetting(parsed.place.page, parsed.place.control));
};
