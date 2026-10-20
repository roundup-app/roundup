//! Prints `<first line> <last line> <name>` for each test function of the Rust file named by the argument: the span
//! from its first outer attribute or doc comment to its closing brace, including tests a macro body defines.
//! `loop/affected.py` maps a diff onto them (L122).

use proc_macro2::{Delimiter, Span, TokenStream, TokenTree};
use syn::spanned::Spanned;
use syn::visit::Visit;

type Span3 = (usize, usize, String);

#[derive(Default)]
struct Tests(Vec<Span3>);

fn names_test(attr: &syn::Attribute) -> bool {
    attr.path()
        .segments
        .last()
        .is_some_and(|segment| segment.ident == "test")
}

impl<'ast> Visit<'ast> for Tests {
    fn visit_item_fn(&mut self, item: &'ast syn::ItemFn) {
        if let Some(first) = item
            .attrs
            .first()
            .filter(|_| item.attrs.iter().any(names_test))
        {
            let last: Span = item.block.brace_token.span.close();
            self.0.push((
                first.span().start().line,
                last.end().line,
                item.sig.ident.to_string(),
            ));
        }
        syn::visit::visit_item_fn(self, item);
    }

    fn visit_macro(&mut self, mac: &'ast syn::Macro) {
        self.scan(mac.tokens.clone());
    }
}

impl Tests {
    /// Macro bodies are unparsed tokens: a `fn` whose attributes (the run of `#[..]` before it, past `pub` and
    /// `async`) include a test is a test, wherever the macro expands it.
    fn scan(&mut self, tokens: TokenStream) {
        let trees: Vec<TokenTree> = tokens.into_iter().collect();
        for (at, tree) in trees.iter().enumerate() {
            if let TokenTree::Group(group) = tree {
                self.scan(group.stream());
            }
            let TokenTree::Ident(keyword) = tree else {
                continue;
            };
            let (Some(TokenTree::Ident(name)), Some(TokenTree::Group(body))) = (trees.get(at + 1), trees.iter().skip(at + 2).find(
                |tree| matches!(tree, TokenTree::Group(group) if group.delimiter() == Delimiter::Brace),
            )) else {
                continue;
            };
            if keyword != "fn" {
                continue;
            }
            let mut first = at;
            let mut is_test = false;
            while first > 0 {
                match (
                    &trees[first - 1],
                    first.checked_sub(2).map(|before| &trees[before]),
                ) {
                    (TokenTree::Group(attr), Some(TokenTree::Punct(hash)))
                        if hash.as_char() == '#' && attr.delimiter() == Delimiter::Bracket =>
                    {
                        is_test |= attr
                            .stream()
                            .into_iter()
                            .last()
                            .is_some_and(|tree| tree.to_string() == "test");
                        first -= 2;
                    }
                    (TokenTree::Ident(word), _) if word == "pub" || word == "async" => first -= 1,
                    _ => break,
                }
            }
            if is_test && first < at {
                self.0.push((
                    trees[first].span().start().line,
                    body.span_close().end().line,
                    name.to_string(),
                ));
            }
        }
    }
}

fn spans(source: &str) -> Result<Vec<Span3>, syn::Error> {
    let file = syn::parse_file(source)?;
    let mut tests = Tests::default();
    tests.visit_file(&file);
    Ok(tests.0)
}

fn main() {
    let path = std::env::args()
        .nth(1)
        .expect("usage: test-spans <file.rs>");
    let source = std::fs::read_to_string(&path).unwrap_or_else(|error| panic!("{path}: {error}"));
    for (first, last, name) in spans(&source).unwrap_or_else(|error| panic!("{path}: {error}")) {
        println!("{first} {last} {name}");
    }
}

#[cfg(test)]
mod tests {
    use super::spans;

    fn of(source: &str) -> Vec<(usize, usize, String)> {
        spans(source).unwrap()
    }

    fn named(first: usize, last: usize, name: &str) -> (usize, usize, String) {
        (first, last, name.to_string())
    }

    #[test]
    fn l122_a_test_spans_its_attributes_doc_comments_and_body() {
        let source = "use super::*;\n#[test]\nfn first() {\n    work();\n}\n\n#[tokio::test]\nasync fn second() {\n    work();\n}\n\nfn helper() {}\n    #[test] fn third() { work(); }\n/// Why.\n#[should_panic(\n    expected = \"x\"\n)]\n#[test]\n#[ignore]\nfn fourth() {\n    work();\n}\n";
        assert_eq!(
            of(source),
            [
                named(2, 5, "first"),
                named(7, 10, "second"),
                named(13, 13, "third"),
                named(14, 22, "fourth")
            ]
        );
    }

    #[test]
    fn l122_text_that_looks_like_syntax_does_not_move_a_span() {
        for attribute in [
            "#[should_panic(expected = \"[\")]",
            "#[should_panic(/* [ */ expected = \"boom\")]",
            "#[should_panic(expected = r#\"[\"#)]",
            "#[should_panic(expected = \"a\n[\")]",
            "#[should_panic(expected = \"boom\"\n/*\n{\n*/\n)]",
        ] {
            for ending in ["}", "} // end", "} /* { */"] {
                let head =
                    format!("#[test]\nfn before() {{ work(); {ending}\n{attribute}\n#[test]\n");
                let source = format!(
                    "{head}fn example() {{ panic!(\"boom\"); }}\n#[test]\nfn after() {{ work(); {ending}\n"
                );
                let lines = head.lines().count();
                let found = of(&source);
                assert_eq!(
                    found[1],
                    named(3, lines + 1, "example"),
                    "{attribute} {ending}"
                );
                assert_eq!(found.len(), 3);
            }
        }
        let decoy =
            "#[test]\nfn actual() {\n    let fixture = r#\"\n#[test]\nfn decoy() {}\n\"#;\n}\n";
        assert_eq!(of(decoy), [named(1, 7, "actual")]);
    }

    #[test]
    fn l122_a_test_a_macro_defines_has_a_span() {
        let source = "macro_rules! define_test {\n    () => {\n        #[test]\n        fn example() {\n            assert_eq!(1, 1);\n        }\n    };\n}\ndefine_test!();\n";
        assert_eq!(of(source), [named(3, 6, "example")]);
    }
}
