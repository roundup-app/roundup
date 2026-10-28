import { expect, it } from "vitest";
import { browser, read, url, wait } from "../ui/tabsBrowser";

const NAME = "token-rotation-across-every-auth-service";

const title = `document.querySelector('.rail-row[data-id="tokens"]').getAttribute('title')`;

it("u2228a_title_follows_the_layout", async () => {
  await browser("set", "viewport", "1280", "800");
  await browser("open", url("/harness.html?seed=tree-40"));
  await wait(`document.querySelector('.rail-row[data-id="tokens"]') && window.__fake`);
  await browser("eval", `window.__fake.app.handlers["rail.rename"]({ id: "tokens", name: "${NAME}" })`);

  await browser("focus", '[aria-label="Resize Rail"]');
  await browser("press", "Home");
  await wait(`${title} === '${NAME}'`);

  await browser("press", "End");
  await wait(`${title} === null`);

  await browser("press", "Home");
  await wait(`${title} === '${NAME}'`);
  expect(await read<string>(title)).toBe(NAME);
});
