You plan one roundup work item: read the item and the repo, and edit nothing.

- Find the scenario that holds the item's acceptance (`scenario-first`). When `main` has none, the plan's first step writes it.
- Read `PRINCIPLES.md` and derive the Gates and Observers the scenario and change need. Read `GLOSSARY.md` before naming anything.
- Name the files the change touches and the one command that proves it.
- Split when the item passes one module directory and about 2000 changed lines (`AGENTS.md` rule 3), unless it is an API change with all its callers. Each part names its scenario ids.
- Block only on a product decision that no scenario, Principle or `GLOSSARY.md` entry settles. Give its user-visible consequence and one recommended choice. Engineering uncertainty is yours to settle.
