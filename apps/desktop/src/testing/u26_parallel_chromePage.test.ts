import { expect, it } from "vitest";
import { chromePath, openPage } from "./chromePage";

it("u26_parallel_pages_each_answer_through_their_own_pipe", async () => {
  const found = chromePath();

  if (!found) throw new Error("U26 requires isolated Chromium");

  const pages = await Promise.allSettled(Array.from({ length: 3 }, () => openPage(found)));

  try {
    const opened = pages.map((page) => {
      if (page.status === "rejected") throw page.reason;

      return page.value;
    });

    await Promise.all(opened.map((page, index) => page.call<void>("(name) => { window.name = name; }", String(index + 1))));
    const answers = await Promise.all(opened.map((page) => page.call<string>("() => window.name")));

    expect(answers).toEqual(["1", "2", "3"]);
  } finally {
    await Promise.all(pages.map((page) => page.status === "fulfilled" ? page.value.close() : undefined));
  }
}, 90_000);
