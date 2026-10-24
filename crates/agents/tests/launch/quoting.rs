use super::*;
use std::os::unix::ffi::OsStringExt;

#[test]
fn z3742n_quoted_words_round_trip() {
    let mut s = setup();
    s.rup = s.root.path().join("rup '雪;$(echo unsafe)\n*");
    std::fs::write(&s.rup, "").unwrap();
    for attempt in ["", " ", "a'b", "雪", "$HOME;`echo unsafe`\n*", "60"] {
        let argv = s
            .launcher()
            .prepare(folders(&s.dir), "7", attempt, &s.cwd, None, Role::Agent)
            .unwrap();
        let settings = read(Path::new(&argv[2]));
        let command = settings["hooks"]["Stop"][0]["hooks"][0]["command"]
            .as_str()
            .unwrap();
        assert_eq!(
            shlex::split(command).unwrap(),
            [
                format!("ROUNDUP_ATTEMPT={attempt}"),
                s.rup.to_str().unwrap().to_owned(),
                "signal".to_owned(),
                "7".to_owned(),
            ]
        );
    }
}

#[test]
fn z3742n_nul_in_an_attempt_is_refused() {
    let s = setup();
    assert!(
        s.launcher()
            .prepare(
                folders(&s.dir),
                "7",
                "bad\0attempt",
                &s.cwd,
                None,
                Role::Agent
            )
            .is_err()
    );
}

#[test]
fn z3742n_non_utf8_hook_paths_are_refused() {
    for executable in [true, false] {
        let mut s = setup();
        let path = s.root.path().join(OsString::from_vec(b"bad\xff".to_vec()));
        if executable {
            std::fs::write(&path, "").unwrap();
            s.rup = path;
        } else {
            std::fs::create_dir(&path).unwrap();
            s.dir = path;
        }
        assert!(s.prepare("7").is_err());
    }
}
