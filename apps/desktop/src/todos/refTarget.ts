/** The Pad name and, for a section link, the heading of a Ref's `roundup://pad/<name>?project=<key>#<heading>` URL (T27, LK4). */
export const refTarget = (url: string) => {
  const parsed = new URL(url);
  const name = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  const heading = parsed.hash === "" ? null : decodeURIComponent(parsed.hash.slice(1));

  return { name, heading };
};
