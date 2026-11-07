import { cleanup, fireEvent, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { routeWebLinks } from "../app/webLinks";
import { USER } from "../testing/nodes";
import { openPad, openShelf, padOf } from "./padsFixture";

afterEach(cleanup);

it("u6451b_a_pad_link_opens_through_open_target_once", async () => {
  const { app } = await openShelf([padOf("note", USER, "see [the site](https://example.com) now")]);
  const field = await openPad("note");
  const calls: unknown[] = [];
  const stop = routeWebLinks(document, { openTarget: async target => { calls.push(target); } });

  const before = location.href;

  const link = await waitFor(() => {
    const anchor = field.querySelector<HTMLAnchorElement>("a[href]");
    expect(anchor).not.toBeNull();

    return anchor!;
  });

  expect(fireEvent.click(link)).toBe(false);
  stop();
  expect(calls).toEqual([{ kind: "url", url: "https://example.com/" }]);
  expect(location.href).toBe(before);
  expect(field.value).toBe("see [the site](https://example.com) now");
  expect(app.calls.filter(call => call.method === "pad.write")).toHaveLength(0);
});
