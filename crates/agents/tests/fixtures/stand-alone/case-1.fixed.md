The theme audit in roundup://pad/theme-audit?project=demo found seven facts:

1. Dark mode uses 12 colour tokens.
2. Light mode uses 9 colour tokens.
3. Three components hard-code a hex colour.
4. The settings page ignores the theme switch.
5. The switch saves to local storage.
6. The saved value reloads on start.
7. No test covers the switch.

Open question: should the three hard-coded components move to tokens in this pass?

Does this match what you expect?
