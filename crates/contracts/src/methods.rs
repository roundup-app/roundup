//! Typed metadata for the single RPC declarations.
#[cfg(feature = "export")]
pub use crate::declarations::METHODS;
#[cfg(not(feature = "export"))]
pub const METHODS: &[Method<'static>] = include!("../../../contracts/generated/methodTypes.rs");
pub use crate::declarations::owner_namespace;
use specta::{Format, Type};
use std::collections::BTreeSet;

#[derive(Clone)]
pub struct Method<'a> {
    pub name: &'a str,
    pub params: &'a str,
    pub result: &'a str,
}

pub(crate) struct ExportedMethod {
    pub name: &'static str,
    pub params: String,
    pub result: String,
    imports: BTreeSet<(String, String)>,
}

impl ExportedMethod {
    pub(crate) fn method(&self) -> Method<'_> {
        Method {
            name: self.name,
            params: &self.params,
            result: &self.result,
        }
    }
}

pub(crate) fn typed<P: Type, R: Type>(name: &'static str) -> ExportedMethod {
    let mut types = specta::Types::default();
    let params = P::definition(&mut types);
    let result = R::definition(&mut types);
    types.iter_mut(|ty| {
        ty.module_path = ty
            .module_path
            .split("::")
            .nth(1)
            .unwrap_or("")
            .to_string()
            .into();
        if let Some(dt) = &mut ty.ty {
            crate::export::defaults(dt);
        }
    });
    let types = specta_serde::Format
        .map_types(&types)
        .expect("valid contract metadata")
        .into_owned();
    let exporter = specta_typescript::Typescript::default()
        .layout(specta_typescript::Layout::ModulePrefixedName);
    let render = |dt| {
        specta_typescript::primitives::reference(&exporter, &types, dt)
            .expect("exportable method type")
    };
    let ((params, result), references) =
        specta_typescript::collect_references(|| (render(&params), render(&result)));
    let imports = references
        .into_iter()
        .map(|reference| {
            let ty = types
                .get(&reference)
                .expect("registered contract reference");
            (ty.module_path.to_string(), ty.name.to_string())
        })
        .collect();
    ExportedMethod {
        name,
        params,
        result,
        imports,
    }
}

#[cfg(test)]
fn m<'a>(name: &'a str, params: &'a str, result: &'a str) -> Method<'a> {
    Method {
        name,
        params,
        result,
    }
}

/// Every method name the Daemon serves, sorted.
pub fn method_names() -> Vec<&'static str> {
    let mut names: Vec<_> = METHODS.iter().map(|m| m.name).collect();
    names.sort_unstable();
    names
}

/// FNV-1a 64 over `parts`, each followed by a zero byte, as 16 hex digits.
fn fnv1a<'a>(parts: impl IntoIterator<Item = &'a str>) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for part in parts {
        for byte in part.bytes().chain([0]) {
            hash ^= u64::from(byte);
            hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
        }
    }
    format!("{hash:016x}")
}

/// One method's hash (A38): FNV-1a 64 over its name, params and result. It is the method's own line in `contract.ts`.
pub fn method_hash(method: &Method) -> String {
    fnv1a([method.name, method.params, method.result])
}

/// The Contract fingerprint (A38): FNV-1a 64 over each method's name and `method_hash`, in name order.
/// The App derives it from the hashes `contract.ts` lists with the same function (`contractFingerprint`).
pub fn fingerprint_of_hashes(entries: &[(&str, &str)]) -> String {
    let mut sorted = entries.to_vec();
    sorted.sort_unstable_by_key(|(name, _)| *name);
    fnv1a(sorted.into_iter().flat_map(|(name, hash)| [name, hash]))
}

/// The fingerprint of `methods`, in any order.
pub fn fingerprint_of(methods: &[Method]) -> String {
    let hashes: Vec<String> = methods.iter().map(method_hash).collect();
    let entries: Vec<(&str, &str)> = methods
        .iter()
        .zip(&hashes)
        .map(|(method, hash)| (method.name, hash.as_str()))
        .collect();
    fingerprint_of_hashes(&entries)
}

/// The fingerprint of `METHODS`.
pub fn fingerprint() -> String {
    // Rule 7: 11 alternating PR/main samples measured ping p95 at 0.158/0.138 ms (#2549).
    // METHODS is immutable; hash it once instead of allocating and sorting on every daemon.ping.
    static FINGERPRINT: std::sync::LazyLock<String> =
        std::sync::LazyLock::new(|| fingerprint_of(METHODS));
    FINGERPRINT.clone()
}

/// Render `methods` as `contracts/generated/contract.ts`: one line per method, in name order, holding that method's hash.
/// No line depends on any other method, so two changes to the contract merge without a conflict.
pub fn render_contract_typescript_of(methods: &[Method]) -> String {
    let mut sorted: Vec<&Method> = methods.iter().collect();
    sorted.sort_unstable_by_key(|m| m.name);
    let mut out = String::from("// Generated from crates/contracts/src/methods.rs. Do not edit.\n");
    out.push_str("export const CONTRACT = {\n  methods: {\n");
    for method in sorted {
        out.push_str(&format!(
            "    \"{}\": \"{}\",\n",
            method.name,
            method_hash(method)
        ));
    }
    out.push_str("  },\n} as const;\n");
    out
}

/// Render `METHODS` as `contracts/generated/contract.ts`.
#[cfg(test)]
fn render_contract_typescript() -> String {
    render_contract_typescript_of(METHODS)
}

/// Render `METHODS` as `contracts/generated/methods.ts`.
pub(crate) fn render_typescript(methods: &[ExportedMethod]) -> String {
    let aliases: BTreeSet<_> = methods
        .iter()
        .flat_map(|method| method.imports.iter().cloned())
        .collect();
    let mut out = String::from("// Generated from crates/contracts/src/methods.rs. Do not edit.\n");
    for (module, ty) in &aliases {
        let path = if module == "common" {
            ty.to_string()
        } else {
            format!("{module}/{ty}")
        };
        out.push_str(&format!(
            "import type {{ {ty} as {module}_{ty} }} from \"./{path}\";\n"
        ));
    }
    out.push_str("\nexport type RpcMethods = {\n");
    for method in methods {
        out.push_str(&format!(
            "  \"{}\": {{ params: {}; result: {} }};\n",
            method.name, method.params, method.result
        ));
    }
    out.push_str("};\n\nexport type RpcMethodName = keyof RpcMethods;\n");
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn method_names_are_unique() {
        let mut names: Vec<_> = METHODS.iter().map(|m| m.name).collect();
        names.sort_unstable();
        names.dedup();
        assert_eq!(names.len(), METHODS.len());
    }

    fn copy<'a>(methods: &[Method<'a>]) -> Vec<Method<'a>> {
        methods.to_vec()
    }

    #[test]
    fn a38_fingerprint_follows_the_methods_and_types() {
        let base = fingerprint();
        let mut reordered = copy(METHODS);
        reordered.reverse();
        assert_eq!(fingerprint_of(&reordered), base);
        let mut added = copy(METHODS);
        added.push(m("extra.method", "null", "null"));
        assert_ne!(fingerprint_of(&added), base);
        let mut retyped = copy(METHODS);
        retyped[0] = m(retyped[0].name, "other_Params", retyped[0].result);
        assert_ne!(fingerprint_of(&retyped), base);
    }

    #[test]
    fn a38_fingerprint_is_pinned_for_the_app_to_derive() {
        // The App's `contractFingerprint` pins the same literal (`a38_the_app_derives_the_fingerprint_rust_computes`).
        let entries = [("b.two", "0123456789abcdef"), ("a.one", "fedcba9876543210")];
        assert_eq!(fingerprint_of_hashes(&entries), "0595958c4791a090");
    }

    #[test]
    fn a38_a_change_to_one_method_rewrites_only_its_line() {
        let base = render_contract_typescript();
        let lines = |text: &str| -> std::collections::BTreeSet<String> {
            text.lines().map(str::to_owned).collect()
        };
        let mut added = copy(METHODS);
        added.push(m("extra.method", "null", "null"));
        let mut retyped = copy(METHODS);
        retyped[0] = m(retyped[0].name, "other_Params", retyped[0].result);
        for changed in [added, retyped] {
            let after = render_contract_typescript_of(&changed);
            assert_eq!(lines(&after).difference(&lines(&base)).count(), 1);
            assert!(lines(&base).difference(&lines(&after)).count() <= 1);
        }
    }
}
