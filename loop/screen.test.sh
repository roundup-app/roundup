#!/usr/bin/env bash
set -euo pipefail
observer="$(dirname "$0")/screen-observer.py"
if (( $# )); then
  python3 "$observer" "$@"
  exit
fi

observe() { python3 "$observer" "Screen.test_$1"; }
l79_open_native_window_ask_returns_to_loop() { observe l79_open_native_window_ask_returns_to_loop; }
l79_native_window_screen_failure_sets_no_waiting_label() { observe l79_native_window_screen_failure_sets_no_waiting_label; }
l79_mixed_native_ask_preserves_product_and_claude_questions() { observe l79_mixed_native_ask_preserves_product_and_claude_questions; }
l79_logged_in_claude_still_routes_to_mac() { observe l79_logged_in_claude_still_routes_to_mac; }
l79_spec_has_no_native_pr_head_observer() { observe l79_spec_has_no_native_pr_head_observer; }

l79_open_native_window_ask_returns_to_loop
l79_native_window_screen_failure_sets_no_waiting_label
l79_mixed_native_ask_preserves_product_and_claude_questions
l79_logged_in_claude_still_routes_to_mac
l79_spec_has_no_native_pr_head_observer
observe l79_mixed_questions_share_a_line_or_precede_native_checks
observe l79_native_look_and_feel_and_named_window_checks_return_to_loop
