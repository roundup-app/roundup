//! R3696c's retained parser allocation, independent of process RSS and machine load.
use std::alloc::System;

use stats_alloc::{INSTRUMENTED_SYSTEM, Region, StatsAlloc};

#[global_allocator]
static ALLOCATOR: &StatsAlloc<System> = &INSTRUMENTED_SYSTEM;

#[test]
fn r3696c_ten_idle_terminal_grids_retain_under_850_kb() {
    let region = Region::new(ALLOCATOR);
    let parsers: Vec<_> = (0..10)
        .map(|_| {
            let mut parser = vt100::Parser::new(24, 80, 1000);
            parser.process(b"$ ");
            parser
        })
        .collect();
    let stats = region.change();
    let retained = stats.bytes_allocated - stats.bytes_deallocated;
    eprintln!("ten idle parser grids retain {retained} bytes");
    // #3696: 48-byte cells alone cost 921,600 bytes. Recover at least 150 KB
    // while retaining the screen, history capacity and all source annotations.
    assert!(retained < 850_000, "ten idle parsers retain {retained} bytes");
    std::hint::black_box(parsers);
}
