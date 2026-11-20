"""T7745a: the pairs a case-insensitive file system or an extensionless import would confuse."""

import unittest

import guard


class PathCase(unittest.TestCase):
    def test_t7745a_a_component_and_a_module_differing_only_by_case_clash(self):
        paths = ["pads/PadNotes.tsx", "pads/padNotes.ts", "pads/Pads.tsx"]

        self.assertEqual(
            guard.clashes(paths), [["pads/PadNotes.tsx", "pads/padNotes.ts"]]
        )

    def test_t7745a_any_two_paths_differing_only_by_case_clash(self):
        paths = ["docs/a.md", "docs/A.md", "Docs/a.md", "docs/b.md"]

        self.assertEqual(
            guard.clashes(paths), [["Docs/a.md", "docs/A.md", "docs/a.md"]]
        )

    def test_t7745a_one_name_with_two_extensions_and_a_stylesheet_beside_a_component_are_no_clash(
        self,
    ):
        paths = [
            "pads/u5561aBrowser.ts",
            "pads/u5561aBrowser.tsx",
            "ink/FailureLine.tsx",
            "ink/failureLine.css",
        ]

        self.assertEqual(guard.clashes(paths), [])


if __name__ == "__main__":
    unittest.main()
