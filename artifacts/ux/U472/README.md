# U472 copy regression

Baseline: origin/main `0f33c6a0`. Head: `13d9f8f7`.

`ROUNDUP_COPY_BASE_ROOT=/tmp/pr1677-base just capture U471,U472` uses isolated headless browser profiles. The base and head directories pair six seeds at 1280×800 and 1440×800 in light and dark, plus failed clear on tree-40. Base inventories preserve visible text and accessible names; U472 accepts only the declared wording mappings.

All 24 screen comparisons and four journey runs pass. D2, D5 and D6 pass and every passing baseline Check remains passing. The catalogue tests check D15. Journey runs preserve start/retry, take/give control, show/hide work items, clear arguments, exact rejected-clear reason and fallback arguments. The failed-clear captures show the exact failure text on the densest seed. This observes the webview and fake App seam; the user reports what they meet on the Mac.
