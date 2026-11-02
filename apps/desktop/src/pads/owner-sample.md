# moo.md site chrome

## Identity drafts (/tmp/moo-identity/)

Each draft-X/board.png shows the landing and the chain page at 1440×900 and 390×844. The terminal crops are real, taken mid-play. Generator: /tmp/moo-identity/gen.mjs.

| Draft | Type (fontsource, OFL) | Colours | Mark | Top bar | Contrast |
|---|---|---|---|---|---|
| A Ballot | Instrument Serif 400 (+italic), Instrument Sans 400/600 | warm paper #F4F0E6, ink #1C1A16, vermilion #B4380F | the oo of moo drawn as two radio buttons, one chosen | 52px, paper, hairline | ink 15.3, muted 6.4, accent 5.3, white on accent 6.0 |
| B Keycap | Bricolage Grotesque 400/700 | near-black #0E0E0D, ink #EFEBE3, amber #F2B441 | an amber return keycap ⏎ | 48px, dark, search centred | ink 16.2, muted 7.4, accent 10.5, ink on accent 10.0 |
| C Slash | Archivo 400/500/800 | white, black #0B0B0B, chartreuse highlight #D9F65C (background only) | a black square holding a chartreuse slash | 44px black band | ink 19.7, muted 7.5, ink on highlight 16.2, bar text 13.5 |

Every draft keeps the terminal dark. Every draft has one colour scheme and no theme toggle. On mobile, every top bar keeps the mark, a search icon and a menu icon.

## Step 2 needs

- Shared with builder-renders-demos (asked on 2026-11-01; waiting for the reply):
  1. astro.config.mjs: Header override, no sidebar, title moo.md. I edit it only after it commits.
  2. Chips, captions and controls read --sl-color-*. Either my identity sets those tokens, or it moves to --demo-* tokens.
  3. Landing demo: on index.mdx, stripMoves gives ["index"] and the build throws. moves: in frontmatter hides the rule h1. This needs its agreement. It is the likeliest blocker.
  4. The row-fit script measures from main and innerHeight. I send it the bar height once fixed.
  5. I build with --outDir dist-chrome and preview on :4340. :4331 stays its own.
- Stage only my own paths. Never stash: we share one working tree.

## Agreement with builder-renders-demos (2026-11-01)

| # | Term |
|---|---|
| 1 | I may edit astro.config.mjs now. Keep its PageTitle override registered: PageTitle draws the strip. |
| 2 | I set the --sl-* tokens to the identity. No --demo-* layer. The terminal's own colours stay as recorded. |
| 3 | It adds the landing demo: a visible h1 with the strip under it. I told it chainScene, moves compose→freeze→deepen→widen→anchor, h1 "Never delegate a decision." |
| 4 | The bar is fixed-height CSS. I send it the exact px after the pick. |
| 5 | I build to dist-chrome and preview on :4340. |

Rules from it: everything above the terminal keeps a fixed CSS height before first paint (bar, title panel, padding). Use the view-transition names demo-term and demo-controls nowhere else. Keep `@view-transition { navigation: auto }` on demo pages. Its tree was clean at 909c0db.

## Built before the pick (independent of the identity, uncommitted)

- TopBar.astro is the Header override. It holds the mark, the Chains▾ and Moves▾ popovers built from the content collections, Install, Starlight Search restyled as ⌘K, and GitHub. Under 50rem everything folds into one Menu sheet.
- routeData.ts sets hasSidebar=false. builder-renders-demos' commit efab0fe swept it in.
- chrome.css fixes --sl-nav-height at 3rem for every width.
- Mark.astro is a placeholder wordmark until the pick.
- Preview: dist-chrome served by python http.server on :4340 (/tmp/moo-serve/moo.md → dist-chrome). Astro 7 runs only one preview at a time.
- Landing plan: keep the splash Hero for the h1 and tagline. Wrap the install commands in a .landing-side div and Strip+Demo in a .landing-demo div. Grid them through .sl-container with display:contents on the markdown. Desktop: two columns. Mobile: hero, an Install action, then the demo. Index.mdx edit asked of builder-renders-demos (message 223).

## Build: A Ballot (2026-11-01)

- Same terminal box on every demo page and the landing. At 1440×900 it is 208,167 871×657 with 31 rows. At 390×844 it is 16,191 346×554 with 26 rows. No page scrolls.
- The landing is no longer a splash page. PageTitle draws a .lead row: h1.rule plus the Strip. A margin note (tagline, Install hope, chains) sits at ≥85rem.
- Install stays in the bar at every width.
- Links: linkinator finds every internal link at 200. The only "broken" links are rel=canonical URLs on saadshahd.github.io/moo.md, which return 404 until Pages is live.
- Console: no errors or warnings on any page at either size. The capture was checked with a probe.
- Lighthouse script: /tmp/moo-tools/lh.sh. It runs against serve on :4341, which serves /tmp/moo-serve (dist-chrome). Reports go to /tmp/moo-identity/lh/.
- Go-live: .github/workflows/site.yml already deploys on push to main (site/**).

## Final checks (HEAD 0ac6f7e, dist-chrome)

Lighthouse scores (performance / accessibility / best practices) on serve :4341, which compresses with br and gzip as Pages does. Verified: uses-text-compression = 1, and the HTML transfers 13 KB of 72 KB. Reports are in /tmp/moo-identity/lh-gz/.

| Page | Mobile | Desktop |
|---|---|---|
| / | 100 100 96 | 100 100 96 |
| install | 99 100 100 | 100 100 100 |
| both chains | 98–99 100 100 | 100 100 100 |
| 4 moves | 99 100 100 | 100 100 100 |
| 404 | 99 100 100 | 100 100 100 |

- The front page's 96 for best practices comes from one request: Chrome asks for /favicon.ico at the server root and gets a 404. It happens under serve only. Under python http.server the front page scores 100. On Pages that root is the saadshahd.github.io user site, so it needs checking live.
- With no compression (python http.server), mobile performance is 88–94. The cost is 226 KB of uncompressed text.
- Lighthouse runs with the zero-weight label-content-name-mismatch check. It flags Starlight's Search button: aria-label "Search" against the visible "Search ⌘K".
- A forced dark system setting (localStorage starlight-theme=dark) gives the same look as light.
- Search results still use Pagefind's layout (page icons, tree lines), recoloured to the identity.

