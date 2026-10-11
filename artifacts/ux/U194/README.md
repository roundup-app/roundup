# U194 rendered observer

Headless agent-browser on `just harness decisions 5199` (fake Daemon). `observe.sh` opens a 300-character `Bash` Decision on agent-1 at 1280×800 and 700×800 and prints the Card's and each button's `getBoundingClientRect()` and `elementFromPoint(centre) === button`, with the order line shown and with it removed from layout; it exits non-zero on a miss. `observer.txt` is its output: `allow` and `deny` lie inside the Card and are hit at their centres in all four runs, and the order line starts at the Card's bottom edge.
