//! Pad names become file names, so they must not be able to escape the pads directory.

use crate::Error;

pub fn validate(name: &str) -> Result<(), Error> {
    let bad = name.is_empty()
        || name.starts_with('.')
        || name.contains(['/', '\\', '\0'])
        || name.contains("..");
    if bad {
        return Err(Error::new(
            rpc::code::INVALID_PARAMS,
            format!("invalid pad name: {name:?}"),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::validate;

    #[test]
    fn p8_accepts_plain_names() {
        for name in ["notes", "plan-2", "a.b", "Ünï code"] {
            assert!(validate(name).is_ok(), "{name:?}");
        }
    }
}
