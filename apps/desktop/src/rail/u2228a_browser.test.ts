import { expect, it } from "vitest";
import { browser, read, url, wait } from "../ui/tabsBrowser";

const NAME = "token-rotation";
const title = `document.querySelector('.rail-row[data-id="tokens"]').getAttribute('title')`;
const width = (value: string) => browser("eval", `document.querySelector('[style*="--rail-width"]').style.setProperty('--rail-width', '${value}')`);

it("u2228a_title_follows_the_layout", async () => {
  await browser("set", "viewport", "1280", "800");
  await browser("open", url("/harness.html?seed=tree-40"));
  await wait(`document.querySelector('.rail-row[data-id="tokens"]') && window.__fake`);

  await width("110px");
  await wait(`${title} === '${NAME}'`);

  await width("600px");
  await wait(`${title} === null`);

  await width("110px");
  await wait(`${title} === '${NAME}'`);
  expect(await read<string>(title)).toBe(NAME);
});
