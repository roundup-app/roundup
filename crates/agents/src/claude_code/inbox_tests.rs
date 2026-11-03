use super::*;
use crate::claude_code::toolcall::tests::measured;
use std::io::Cursor;

struct Counted<R> {
    inner: R,
    bytes: usize,
    fail: Option<usize>,
}
impl<R: Read> Read for Counted<R> {
    fn read(&mut self, out: &mut [u8]) -> std::io::Result<usize> {
        if self.fail.is_some_and(|limit| self.bytes >= limit) {
            return Err(std::io::Error::other("injected read"));
        }
        let max = self
            .fail
            .map_or(out.len(), |limit| out.len().min(limit - self.bytes));
        let n = self.inner.read(&mut out[..max])?;
        self.bytes += n;
        Ok(n)
    }
}
impl<R: Seek> Seek for Counted<R> {
    fn seek(&mut self, pos: SeekFrom) -> std::io::Result<u64> {
        self.inner.seek(pos)
    }
}
fn line(id: u32) -> String {
    format!(
        "{{\"origin\":{{\"kind\":\"peer\",\"msg_id\":\"00000000-0000-4000-8000-{id:012x}\"}}}}\n"
    )
}

#[test]
fn b5718a_oversized_complete_records_keep_receipts_with_bounded_allocations() {
    let peer = line(7);
    let peer = peer
        .trim()
        .strip_prefix('{')
        .unwrap()
        .strip_suffix('}')
        .unwrap();
    let attachment = format!("\"attachment\":{{{peer}}}");
    let mut cases = vec![
        (format!("{{\"before\":\"$\",{peer},\"after\":\"$\"}}\n"), vec![7]),
        (format!("{{\"attachment\":{{\"before\":\"$\",{peer},\"after\":\"$\"}}}}\n"), vec![7]),
        (format!("{{\"origin\":{{\"kind\":\"local\"}},{attachment},\"unused\":\"$\"}}\n"), vec![]),
        (format!("{{{peer},{},\"unused\":\"$\"}}\n", attachment.replace("000007", "00000b")), vec![7]),
        (format!("{{\"origin\":null,{attachment},\"unused\":\"$\"}}\n"), vec![7]),
        (format!("{{{peer},\"unused\":\"$\",!}}\n{}", line(11)), vec![11]),
        ("{\"unused\":\"$\\\"origin\\\":{\\\"kind\\\":\\\"peer\\\",\\\"msg_id\\\":\\\"00000000-0000-4000-8000-000000000007\\\"}\"}\n".into(), vec![]),
    ];
    let mut escaped_cases = vec![(cases.last().unwrap().0.clone(), vec![])];
    for invalid in ["\\q", "\\uD800", "\\uDC00", "\t"] {
        cases.push((
            format!("{{{peer},\"unused\":\"${invalid}\"}}\n{}", line(11)),
            vec![11],
        ));
    }
    cases.push((
        format!("{{{peer},\"unused\":\"$é🦀\\uD83D\\uDE00\"}}\n"),
        vec![7],
    ));
    for nested in [false, true] {
        for before in [false, true] {
            let fields = peer
                .strip_prefix("\"origin\":{")
                .unwrap()
                .strip_suffix('}')
                .unwrap();
            let origin = if before {
                format!("\"origin\":{{\"unused\":\"$\",{fields}}}")
            } else {
                format!("\"origin\":{{{fields},\"unused\":\"$\"}}")
            };
            cases.push((
                if nested {
                    format!("{{\"attachment\":{{{origin}}}}}\n")
                } else {
                    format!("{{{origin}}}\n")
                },
                vec![7],
            ));
        }
    }
    for (field, escaped) in [
        ("\"unused\":\"$\"", true),
        ("\"$\":null", false),
        ("\"unused\":{\"array\":[{\"text\":\"$\"}]}", false),
    ] {
        for before in [false, true] {
            let template = if before {
                format!("{{{field},{peer}}}\n")
            } else {
                format!("{{{peer},{field}}}\n")
            };
            if escaped {
                escaped_cases.push((template.clone(), vec![7]));
            }
            cases.push((template, vec![7]));
        }
    }
    let mut maximum = 0;
    for size in [1, 16, 64] {
        for escaped in [false, true] {
            let large = if escaped {
                let pattern = format!("\\\\\\u0061{}", "x".repeat(56));
                pattern.repeat(size * 1024 * 1024 / 64)
            } else {
                "x".repeat(size * 1024 * 1024)
            };
            let mut transcript = tempfile::NamedTempFile::new().unwrap();
            for (template, want) in if escaped { &escaped_cases } else { &cases } {
                // B5718a took 7.059 s in CI. Reuse the file and write template
                // parts directly so fixture copies don't consume the test budget.
                let file = transcript.as_file_mut();
                file.rewind().unwrap();
                let mut parts = template.split('$');
                file.write_all(parts.next().unwrap().as_bytes()).unwrap();
                for part in parts {
                    file.write_all(large.as_bytes()).unwrap();
                    file.write_all(part.as_bytes()).unwrap();
                }
                let end = file.stream_position().unwrap();
                file.set_len(end).unwrap();
                let (result, allocated) = measured(|| recorded(transcript.path(), 0));
                assert_eq!(result, (want.clone(), end), "{template}");
                assert!(
                    allocated <= 256 * 1024,
                    "{size} MiB escaped={escaped}: {allocated} bytes, {template}"
                );
                maximum = maximum.max(allocated);
            }
        }
    }
    eprintln!("B5718a maximum allocated per scan: {maximum} bytes");
}

#[test]
fn b5718b_unfinished_records_complete_without_unbounded_allocations() {
    let mut maximum = 0;
    for size in [1, 16, 64] {
        let large = "x".repeat(size * 1024 * 1024);
        for before in [false, true] {
            for inside_string in [false, true] {
                let peer = line(7);
                let peer = peer
                    .trim()
                    .strip_prefix('{')
                    .unwrap()
                    .strip_suffix('}')
                    .unwrap();
                let prefix = line(3);
                let tail = if before {
                    format!("{{{peer},\"unused\":\"{large}")
                } else {
                    format!("{{\"unused\":\"{large}")
                };
                let suffix = if before {
                    "\"}".to_owned()
                } else {
                    format!("\",{peer}}}")
                };
                let fixture = if inside_string {
                    format!("{prefix}{tail}")
                } else {
                    format!("{prefix}{tail}{suffix}")
                };
                let transcript = tempfile::NamedTempFile::new().unwrap();
                std::fs::write(transcript.path(), fixture).unwrap();
                let mut cursor = 0;
                for scan in 0..3 {
                    let (result, allocated) = measured(|| recorded(transcript.path(), cursor));
                    assert_eq!(
                        result,
                        (
                            if scan == 0 { vec![3] } else { vec![] },
                            prefix.len() as u64
                        )
                    );
                    assert!(allocated <= 256 * 1024, "{size} MiB: {allocated} bytes");
                    maximum = maximum.max(allocated);
                    cursor = result.1;
                }
                let mut counted = Counted {
                    inner: std::fs::File::open(transcript.path()).unwrap(),
                    bytes: 0,
                    fail: None,
                };
                let tail_bytes = transcript.as_file().metadata().unwrap().len() - cursor;
                assert_eq!(recorded_from(&mut counted, cursor), (vec![], cursor));
                assert_eq!(counted.bytes as u64, tail_bytes);
                let finish = if inside_string {
                    format!("{suffix}\n")
                } else {
                    "\n".into()
                };
                std::fs::OpenOptions::new()
                    .append(true)
                    .open(transcript.path())
                    .unwrap()
                    .write_all(finish.as_bytes())
                    .unwrap();
                let end = transcript.as_file().metadata().unwrap().len();
                let (result, allocated) = measured(|| recorded(transcript.path(), cursor));
                assert_eq!(result, (vec![7], end));
                assert!(allocated <= 256 * 1024, "completion: {allocated} bytes");
                maximum = maximum.max(allocated);
                counted.bytes = 0;
                assert_eq!(recorded_from(&mut counted, end), (vec![], end));
                assert_eq!(counted.bytes, 0);
            }
        }
    }
    eprintln!("B5718b maximum allocated per scan: {maximum} bytes");
}

#[test]
fn b5718b_malformed_unfinished_records_rescan_with_bounded_allocations() {
    let prefix = line(3);
    let peer = line(7);
    for size in [1, 16, 64] {
        let large = "x".repeat(size * 1024 * 1024);
        for (tail, completion) in [("\\q", "\"}"), ("\"}\"", "")] {
            let fixture = format!(
                "{prefix}{{{},\"unused\":\"{large}{tail}",
                peer.trim()
                    .strip_prefix('{')
                    .unwrap()
                    .strip_suffix('}')
                    .unwrap()
            );
            let transcript = tempfile::NamedTempFile::new().unwrap();
            std::fs::write(transcript.path(), fixture).unwrap();
            let mut cursor = 0;
            for scan in 0..3 {
                let (result, allocated) = measured(|| recorded(transcript.path(), cursor));
                assert_eq!(
                    result,
                    (
                        if scan == 0 { vec![3] } else { vec![] },
                        prefix.len() as u64
                    ),
                    "malformed unfinished string, {size} MiB, scan {scan}"
                );
                assert!(
                    allocated <= 256 * 1024,
                    "malformed unfinished string, {size} MiB, scan {scan}: {allocated} bytes, bound 256 KiB"
                );
                cursor = result.1;
            }
            let finish = format!("{completion}\n{}", line(11));
            std::fs::OpenOptions::new()
                .append(true)
                .open(transcript.path())
                .unwrap()
                .write_all(finish.as_bytes())
                .unwrap();
            let end = transcript.as_file().metadata().unwrap().len();
            let (result, allocated) = measured(|| recorded(transcript.path(), cursor));
            assert_eq!(result, (vec![11], end), "malformed recovery, {size} MiB");
            assert!(
                allocated <= 256 * 1024,
                "malformed recovery, {size} MiB: {allocated} bytes, bound 256 KiB"
            );
        }
    }
}

#[test]
fn b5635a_receipt_reads_only_appended_bytes() {
    let record = format!(
        "{{\"unused\":\"{}\",\"nested\":{{\"array\":[1,2,3]}}}}\n",
        "x".repeat(900)
    );
    let fixture = record.repeat((30 * 1024 * 1024) / record.len() + 1);
    let transcript = tempfile::NamedTempFile::new().unwrap();
    std::fs::write(transcript.path(), fixture).unwrap();
    let mut file = Counted {
        inner: std::fs::File::open(transcript.path()).unwrap(),
        bytes: 0,
        fail: None,
    };
    let ((ids, mut offset), allocated) = measured(|| recorded_from(&mut file, 0));
    assert!(ids.is_empty());
    assert!(
        allocated <= 256 * 1024,
        "initial scan {allocated} bytes, bound 256 KiB"
    );
    file.bytes = 0;
    let (_, allocated) = measured(|| recorded_from(&mut file, offset));
    assert_eq!(file.bytes, 0);
    assert!(
        allocated <= 64 * 1024,
        "unchanged scan {allocated} bytes, bound 64 KiB"
    );
    let mut appended = 0;
    for id in 1..=100 {
        let line = line(id);
        appended += line.len();
        std::fs::OpenOptions::new()
            .append(true)
            .open(transcript.path())
            .unwrap()
            .write_all(line.as_bytes())
            .unwrap();
        let (ids, next) = recorded_from(&mut file, offset);
        assert_eq!(ids, [id]);
        assert_eq!(next - offset, line.len() as u64);
        offset = next;
    }
    assert_eq!(file.bytes, appended);
}

#[test]
fn b5635a_receipt_fields_and_cursor_failures() {
    for (prefix, want) in [
        ("null", vec![7]),
        ("{}", vec![]),
        ("{\"kind\":\"local\"}", vec![]),
    ] {
        let nested = line(7);
        let record = format!("{{\"origin\":{prefix},\"attachment\":{}}}\n", nested.trim());
        assert_eq!(recorded_from(Cursor::new(record.as_bytes()), 0).0, want);
    }
    for record in [
        "bad\n",
        "{}\n",
        "{\"origin\":{\"kind\":\"peer\",\"msg_id\":\"foreign\"}}\n",
    ] {
        assert_eq!(
            recorded_from(Cursor::new(record), 0),
            (vec![], record.len() as u64)
        );
    }
    let mut bytes = line(9).into_bytes();
    let complete = bytes.len() as u64;
    bytes.extend_from_slice(b"\xf0\x9f");
    assert_eq!(recorded_from(Cursor::new(&bytes), 0), (vec![9], complete));
    assert_eq!(recorded_from(Cursor::new(b"{}\n"), 99), (vec![], 3));
    let bytes = line(9) + &line(10);
    let mut file = Counted {
        inner: Cursor::new(bytes),
        bytes: 0,
        fail: Some(complete as usize),
    };
    assert_eq!(recorded_from(&mut file, 0), (vec![], 0));
    let prefix = line(3);
    let oversized =
        prefix.clone() + &line(7) + &format!("{{\"unused\":\"{}\"}}\n", "x".repeat(1024 * 1024));
    let mut file = Counted {
        inner: Cursor::new(oversized),
        bytes: 0,
        fail: Some(16 * 1024),
    };
    assert_eq!(
        recorded_from(&mut file, prefix.len() as u64),
        (vec![], prefix.len() as u64)
    );
    struct FailedSeek;
    impl Read for FailedSeek {
        fn read(&mut self, _: &mut [u8]) -> std::io::Result<usize> {
            unreachable!()
        }
    }
    impl Seek for FailedSeek {
        fn seek(&mut self, _: SeekFrom) -> std::io::Result<u64> {
            Err(std::io::Error::other("seek"))
        }
    }
    assert_eq!(recorded_from(FailedSeek, 17), (vec![], 17));
    assert_eq!(
        recorded(Path::new("/absent/receipt.jsonl"), 17),
        (vec![], 17)
    );
}
