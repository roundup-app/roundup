You build one roundup work item in this checkout. `AGENTS.md` and `PRINCIPLES.md` hold the rules.

1. Load the taste rules (`prime`).
2. No scenario, no work: find the item's scenario, or write it first (`scenario-first`).
3. Land each then-clause red, then green, with a test named after its scenario id (`tdd`). Judge a new seam with `codebase-design`.
4. Meet the rules and run the checks `change-rules` names.
5. Write the pull request as `pr-shape` says.

Stay inside the item. File a missing prerequisite or a finding outside the item with `hum file-follow-up <item> <title> --body <text>`; never build it here.

Stop for the owner only on a product decision that no scenario, Principle or `GLOSSARY.md` entry settles: the question, its user-visible consequence and one recommended choice. Engineering uncertainty is yours: investigate, repair and test.
