import { expect, it } from "vitest";
import { browser, read, url, wait } from "../ui/tabsBrowser";

// The `tokens` row holds its status beside the name (U6640a), so the widest Rail leaves the name less room than the row's width: a name the widest Rail holds, and the narrow end cuts.
const NAME = "token-rotation-and-audit";

const title = `document.querySelector('.rail-row[data-id="tokens"]').getAttribute('title')`;

it("u2228a_title_follows_the_layout", async () => {
  await browser("set", "viewport", "1280", "800");
  await browser("open", url("/harness.html?seed=tree-40"));
  await wait(`document.querySelector('.rail-row[data-id="tokens"]') && window.__fake`);
  await browser("eval", `window.__fake.app.handlers["rail.rename"]({ id: "tokens", name: "${NAME}" })`);

  await browser("focus", '[aria-label="Resize Rail"]');
  // Home is the collapse key (U6228); Shift+Left steps the open Rail down to its narrow end.
  const narrow = async () => { for (let step = 0; step < 4; step++) await browser("press", "Shift+ArrowLeft"); };

  await browser("press", "End");
  await wait(`${title} === null`);

  await narrow();
  await wait(`${title} === '${NAME}'`);

  await browser("press", "End");
  await wait(`${title} === null`);

  await narrow();
  await wait(`${title} === '${NAME}'`);
  expect(await read<string>(title)).toBe(NAME);
});
