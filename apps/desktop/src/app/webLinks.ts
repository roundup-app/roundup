import type { AppSeam } from "./seam";

const web = new Set(["http:", "https:", "mailto:"]);

/** U6451a: a clicked anchor in any surface opens a web or mail address in the default browser through `openTarget` (U365b) and never navigates the window; the native guard refuses what this misses. */
export const routeWebLinks = (doc: Document, app: Pick<AppSeam, "openTarget">): (() => void) => {
  const route = (event: MouseEvent) => {
    const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;

    if (!anchor) return;

    const raw = anchor.getAttribute("href") ?? "";
    const target = URL.canParse(raw, doc.baseURI) ? new URL(raw, doc.baseURI) : null;

    if (raw.startsWith("#") && target?.origin === new URL(doc.baseURI).origin) return;

    event.preventDefault();

    if (!target || !web.has(target.protocol) || target.origin === new URL(doc.baseURI).origin) return;

    void app.openTarget({ kind: "url", url: target.href }).catch(error => console.error(error));
  };

  doc.addEventListener("click", route, true);
  doc.addEventListener("auxclick", route, true);

  return () => {
    doc.removeEventListener("click", route, true);
    doc.removeEventListener("auxclick", route, true);
  };
};
