import { within } from "@solidjs/testing-library";

/** The alerts or statuses the App shows. ui-sdk keeps one empty live region of each role on the page for its screen-reader announcements; they hold no notice, so a query for "the alert" must not count them. */
export const notices = (role: "alert" | "status", scope: HTMLElement = document.body): HTMLElement[] =>
  within(scope).queryAllByRole(role).filter(region => !region.hasAttribute("data-ui-sdk-announcer"));

/** The one alert or status the App shows; a test that expects it fails here when none is shown. */
export const notice = (role: "alert" | "status", scope: HTMLElement = document.body): HTMLElement => {
  const [shown] = notices(role, scope);

  if (!shown) throw new Error(`No ${role} is shown`);

  return shown;
};
