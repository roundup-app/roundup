//! Prints `<first line> <last line> <name>` for each test function of the Rust file named by the argument: the span
//! from its first outer attribute or doc comment to its closing brace. `loop/affected.py` maps a diff onto them (L122).

use proc_macro2::Span;
use syn::spanned::Spanned;
use syn::visit::Visit;

struct Tests(Vec<(usize, usize, String)>);

impl<'ast> Visit<'ast> for Tests {
    fn visit_item_fn(&mut self, item: &'ast syn::ItemFn) {
        let is_test = |attr: &syn::Attribute| {
            attr.path()
                .segments
                .last()
                .is_some_and(|segment| segment.ident == "test")
        };
        if let Some(first) = item
            .attrs
            .first()
            .filter(|_| item.attrs.iter().any(is_test))
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
}

fn main() {
    let path = std::env::args()
        .nth(1)
        .expect("usage: test-spans <file.rs>");
    let source = std::fs::read_to_string(&path).unwrap_or_else(|error| panic!("{path}: {error}"));
    let file = syn::parse_file(&source).unwrap_or_else(|error| panic!("{path}: {error}"));
    let mut tests = Tests(Vec::new());
    tests.visit_file(&file);
    for (first, last, name) in tests.0 {
        println!("{first} {last} {name}");
    }
}
