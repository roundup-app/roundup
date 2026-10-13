import { expect, it } from "vitest";
import { chromePath, openPage } from "./chromePage";

it("u26_parallel_pages_each_answer_through_their_own_pipe", async () => {
  const found = chromePath();

  if (!found) throw new Error("U26 requires isolated Chromium");

  const pages = await Promise.allSettled(Array.from({ length: 3 }, () => openPage(found)));

  try {
    const answers = await Promise.all(pages.map(async (page) => {
      if (page.status === "rejected") throw page.reason;

      return page.value.call<number>("() => 42");
    }));

    expect(answers).toEqual([42, 42, 42]);
  } finally {
    await Promise.all(pages.map((page) => page.status === "fulfilled" ? page.value.close() : undefined));
  }
}, 90_000);
