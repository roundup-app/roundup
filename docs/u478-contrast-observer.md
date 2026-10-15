# U478 native contrast observer prerequisite

`u478_native_contrast_selects_stylesheet` in `u478-contrast-observer.test.mjs` selects
native increased contrast through agent-browser 0.27.0 on Linux x64. It verifies
both colour schemes and their normal-contrast controls. This delivers #1944's
observer prerequisite for #1852; it does not complete U478 or supply Token or
rendered App regression evidence.

From a clean checkout with Node 22, npm, curl, unzip and Chrome's Linux runtime
libraries available:

```sh
npm install --global agent-browser@0.27.0
mkdir -p /tmp/u478-browser-155.0.8059.79
curl --fail --location --max-time 180 \
  https://storage.googleapis.com/chrome-for-testing-public/155.0.8059.79/linux64/chrome-linux64.zip \
  --output /tmp/u478-browser-155.0.8059.79/chrome.zip
unzip -q -o /tmp/u478-browser-155.0.8059.79/chrome.zip -d /tmp/u478-browser-155.0.8059.79
node docs/u478-contrast-observer.test.mjs \
  /tmp/u478-browser-155.0.8059.79/chrome-linux64/chrome \
  > /tmp/u478-native-contrast.log
```

The driver asserts the exact CLI and Chrome for Testing versions, logs every
command's argument array, actual exit code, stdout and stderr, and exits nonzero
on a failed launch or assertion. Without an argument it uses agent-browser's
cached `~/.agent-browser/browsers/chrome-155.0.8059.79/chrome` and still verifies
the version. `agent-browser install` alone downloads a moving stable version,
so it is not the pinned reproduction command.

Each case uses a new temporary profile and unique daemon name, an explicit empty
configuration with `headed:false`, and no inherited `AGENT_BROWSER_*` settings.
The driver runs outside the checkout's configuration directory, waits for the
fixture's DOM node, closes only its own named browser and removes its temporary
files. It neither replaces `matchMedia` nor changes the media rules at runtime.

For downstream observers, launch a fresh profile with these arguments (substitute
an isolated profile path, unique name, pinned executable and harness URL):

```sh
agent-browser --config /tmp/isolated-config.json \
  --session u478-unique-name --profile /tmp/fresh-u478-profile \
  --executable-path /tmp/u478-browser-155.0.8059.79/chrome-linux64/chrome \
  --color-scheme light \
  --args '--force-high-contrast,--disable-features=ForcedColors' open '<harness URL>'
```

Write `{"headed":false}` to the isolated config first. Use `dark` for the second
scheme; omit `--args` for normal contrast. Keep the same unique name/config on
subsequent commands, and close that named browser afterwards. Check native media
readings in the target page before collecting evidence. No CDP attachment is
needed. Preserve the flags for the browser's lifetime rather than using
`set media light more`, whose third argument does not select contrast in 0.27.0.

The selected setup reuses [agent-browser 0.27.0](https://github.com/vercel-labs/agent-browser/releases/tag/v0.27.0)
and [Chrome for Testing](https://github.com/GoogleChromeLabs/chrome-for-testing#json-api-endpoints).
Its versioned Chromium sources implement
[`force-high-contrast`](https://github.com/chromium/chromium/blob/155.0.8059.79/ui/native_theme/native_theme.cc)
and the separately controlled
[`ForcedColors` runtime feature](https://github.com/chromium/chromium/blob/155.0.8059.79/content/child/runtime_features.cc).
The combination retains the native contrast preference while disabling forced
colours; the observer asserts both rather than inferring one from the other.
[Playwright's contrast option](https://playwright.dev/docs/api/class-browser#browser-new-context-option-contrast)
is an alternative maintained API, but a standalone Playwright observer would
not exercise Builder's required agent-browser path. No custom media emulator,
manifest change or browser fork is needed.

Recorded on Linux x64, Node v22.23.3, agent-browser 0.27.0 and Chrome for Testing
155.0.8059.79, from base `e7af103b1d1b4522c2051eccadbfde4e472a42e8`:

| Scheme | Requested contrast | Native more | Native forced colours | Fixture computed width | Observer exit |
| --- | --- | --- | --- | --- | --- |
| light | normal | false | false | 10px | 0 |
| light | more | true | false | 20px | 0 |
| dark | normal | false | false | 10px | 0 |
| dark | more | true | false | 20px | 0 |

The fixture declares `#probe { width: 10px }` followed by
`@media (prefers-contrast: more) { #probe { width: 20px } }`.
Every case also asserts its native colour-scheme reading is true. The committed
red observer failed with `false !== true` (exit 1) before launch flags were added.
All version, open, DOM-wait, eval and close commands in the passing run exit 0;
the driver prints their exact expanded commands for reproduction/audit.
