# PDP-10 JavaScript emulator: status and TODO

Baseline: 2026-11-25, emulator commit 7204103.
Target: a reliable native Node.js KI10 emulator with the existing graphical
front panel, suitable for historical software and eventual DAIMOS testing.
Preserve the standalone browser implementation. Prefer correctness, low
host RAM consumption and execution speed over additional features. All
regression tests belong in daimos-testkit.

Status terminology: implemented means that code exists, not that the
hardware behavior has been fully verified. Only explicitly recorded PASS
results constitute executed acceptance tests.

## 1. Completed work

- [x] Native Node.js runtime, no npm dependencies (b452782).
- [x] Alpine edge Node.js v26.13.1 installed and verified.
- [x] Share original CPU, arithmetic, I/O and bootstrap code with browser.
- [x] Local asynchronous SIMH image access, 1 MiB blocks, zero padding
      at EOF, release CPU after transfer failures.
- [x] Raw CTY input/output, queued typeahead and interactive Ctrl-] exit;
      Ctrl-C is passed to the guest.
- [x] Host printer output callback (handler only; guest LPT still disabled).
- [x] Remove contextified VM execution overhead (7204103): use
      vm.compileFunction with shared lexical state and explicit callbacks.
      Representative loader batches grew from roughly 350 to 30000
      instructions per eight-millisecond batch (~86x; not a controlled
      CPU benchmark).
- [x] Obtain and validate the four original TOPS-10 6.03A RP03 images.
- [x] Boot real TOPS-10, log in and execute SYSTAT in native Node.js.
- [x] Push emulator commits to main and diagnostic/documentation commits
      to their respective pdp10-js-node-v1 branches.

### Original disk media

Local installation: $HOME/pdp10-images/tops10-603a-ki10-v1/

| Image | Bytes | 36-bit words |
| --- | ---: | ---: |
| dpa0.dsk | 81904640 | 10238080 |
| dpa1.dsk | 81912832 | 10239104 |
| dpa2.dsk | 81913856 | 10239232 |
| dpa3.dsk | 81920000 | 10240000 |

Source: https://skn.noip.me/pdp10/ (not bundled in Git).
All 40956416 stored words were scanned for valid 36-bit values in
eight-byte little-endian containers. SHA256SUMS is alongside the images.
Images are shorter than the controller's nominal full geometry; the
current cache zero-pads reads at EOF. Source media remain read-only.
Guest writes are volatile. No magnetic tape image has been validated.

    node node.js --media-dir "$HOME/pdp10-images/tops10-603a-ki10-v1"

At the boot prompt enter boot dpa0, press RETURN when prompted,
and follow the historical startup/login example in README.md.

### Verified regression baseline

| Test | Result |
| --- | --- |
| Local image block reads, short block, EOF and missing image | PASS |
| Cache padding, printer callback, panel switch state | PASS |
| CTY HELP, missing-disk recovery, synthetic RP03 boot to HALT | PASS |
| Original RP03 BOOTS, TOPS-10 startup, operator login, SYSTAT | PASS |
| Browser graphical execution after Node port | Not tested |
| Full DEC instruction diagnostic suite | Not established |
| Guest printer I/O | Not tested; dispatcher disabled |
| Tape boot/read, persistent disk write and panel remote control | Not verified |

Real boot observed KI603 04-21-78, CTY system 514, 64 job slots,
one logged-in job and 8002 pages of core left. The monitor prompt was
reached in about 20 seconds; the complete acceptance test in about
25 seconds in the observed runs. Offline RPA, RPB and DPB messages
are expected for this configuration.

Tests in daimos-testkit, branch pdp10-js-node-v1:
- tests/host/pdp10-js-node-v1.cjs (0bb1beb)
- tests/host/pdp10-js-diags-v3.cjs (d9a27a5)

From a checkout of that branch:

    node tests/host/pdp10-js-node-v1.cjs "$HOME/git/pdp10-js"
    node tests/host/pdp10-js-diags-v3.cjs "$HOME/git/pdp10-js" \
        "$HOME/pdp10-images/tops10-603a-ki10-v1"

Related documentation in pdp10-doc, branch pdp10-js-node-v1:
TOOLS/PDP10-JS-NODE-V1.MD (ae1fbde) and
TOOLS/PDP10-JS-NODE-V2.MD (d24a478).
No changes to the DAIMOS kernel are needed for this emulator baseline.

## 2. Existing hardware coverage

### Processor and memory

KI10 instruction-level emulation, not cycle-accurate. One processor.
36-bit words, 18-bit virtual addresses, 22-bit physical addresses,
512-word pages and four banks of 16 accumulators. Physical storage is
hardcoded to 4194304 words (8192 pages) in a JavaScript Array. Number
represents individual 36-bit words exactly; wide operands are split.

Implemented CPU groups (octal):

| Opcodes | Functions |
| --- | --- |
| 000-077 | LUUO/MUUO handling |
| 100-177 | Byte operations, floating point, double-word operations |
| 200-277 | Moves, integer arithmetic, shifts, stack, JRST/XCT/MAP |
| 300-377 | Comparisons, jumps, skips |
| 400-477 | Boolean operations |
| 500-577 | Half-word operations |
| 600-677 | Bit testing and modification |
| 700-777 | Device I/O |

Executive/user and public/concealed modes, page mapping and protection,
PXCT, arithmetic flags and traps, indexed/indirect addresses and
seven-level priority interrupts have implementations. Floating-point
single, double and long formats are present but incomplete and not
fully verified. Opcodes unsupported by the actual KI10 must still trap;
do not introduce later processor instructions as KI10 workarounds.

### Device inventory (octal I/O addresses)

| Device | Address | Current implementation / limitation |
| --- | --- | --- |
| APR | 000 | Arithmetic processor control, data switches, clock; timer reset and I/O reset incomplete |
| PI | 004 | Priority interrupt controls and status; accuracy audit needed |
| PAG | 010 | KI10 pager and processor serial number 514; accuracy audit needed |
| PTP | 100 | Constant only, no paper tape punch handler |
| PTR | 104 | Stub; DATAO affects panel address/operating switches, no paper tape input |
| TTY | 120 | Single CTY, busy/done and interrupts; raw Node characters, browser VT52 |
| LPT | 124 | Handler and host output callback exist; dispatcher case commented out |
| DPC | 250 | RP03 read/write, seek, recalibrate, DMA and interrupts; four online drives |
| MTC/MTS | 340/344 | TM10B, three units, SIMH tape reads/compare/spacing/rewind; partial, no writes |

RP03 nominal geometry: 406 cylinders, 20 surfaces, 10 sectors per
track, 128 words per sector = 81200 sectors and 10393600 words per
drive. DMA control words support 18/22-bit addressing. Ordinary writes
modify the RAM cache; controller read-verify and write-header commands
are incomplete. Only dpa0.dsk through dpa3.dsk are online in the
current controller despite the broader filename range in CLI help.

TM10B models record/file spacing, read and compare commands, rewind
and core-dump packing. Controller status, concurrency, unload and
error behavior need verification. No real tape acceptance test yet.

Not implemented: DECtape, Type 340 and Type 30 displays, drum
storage/controllers, card reader, multiple terminal lines / DC10,
RH10/RH20 Massbus and RP04/RP06, networking, KA10/KL10/KS10 variants,
multiprocessor operation. These are inventory gaps, not commitments
to implement every device.

## 3. Priority 1: DEC diagnostics and CPU correctness

- [ ] Establish a reproducible standalone diagnostic harness using the
      bundled DIAMON.js, SUBRTN.js and 20 DBK*.js images. Validate memory
      load order, initial PC, accumulator/register state, switches,
      monitor startup, completion criteria and required hardware.
- [ ] Locate the original KLAD sources and diagnostic manuals for
      interpreting reports; upstream reference:
      http://pdp-10.trailing-edge.com/klad_sources/index.html
- [ ] Obtain or locate DBKAA-DBKAG and DIAMON.SAV if necessary.
      RUN DIAMON in the currently downloaded TOPS-10 installation
      reports "DIAMON.SAV not found" in the default search path.
      Do not claim the files are absent from every directory.
- [ ] Reproduce upstream reported DBKAA-DBKAG progress and DBKAH
      illegal instruction at user PC 030707; independently verify.
- [ ] Run all applicable bundled diagnostics with bounded execution,
      explicit PASS/FAIL/timeout results and first failing PC/opcode.
- [ ] Investigate DBKAH standalone (executed, no completion established),
      DBKAI (reached SHIFT-ROTATE banner) and DBKDA (floating-point
      discrepancy reports). Verify initialization before treating
      reports as CPU defects.
- [ ] Build focused, source-backed tests for each confirmed CPU bug;
      compare with historical manuals and a known-good KI10 simulator
      (e.g. sims/BIN/pdp10-ki).
- [ ] Audit arithmetic flags, double-word sign/normalization,
      shifts/rotates, floating-point rounding and exceptions,
      byte pointer semantics, indirect and PXCT addressing,
      paging/protection, UUO/trap and PI behavior.
- [ ] Audit nonexistent-memory behavior and undefined panic() calls;
      return correct architectural error/status rather than host crashes.
- [ ] Verify clock timing and APR reset/error semantics.
- [ ] Keep TOPS-10 boot and all existing regressions passing after each
      fix. Do not claim a diagnostic pass solely because it executed.

## 4. Priority 2: original graphical front panel on Node.js

The browser front panel exists in pdp10.html and runs a separate CPU.
The native backend currently exposes CPU/controller state and switch
values, but has no graphical server or remote panel protocol.

- [ ] Retain original KI10 visual layout and browser-only mode.
- [ ] Separate front-panel state/control logic from DOM rendering.
- [ ] Connect the existing front panel to the Node CPU using a small
      WebSocket protocol (proposed design, not yet implemented).
      Browser displays state and sends commands; it must not run a
      second guest CPU in this mode.
- [ ] Expose 36-bit instruction/data lamps, 18-bit PC lamps, PI/pending
      interrupts, CPU modes and operational status; synchronize 18
      address switches, 36 data switches and operating switches.
- [ ] Implement START, STOP, CONTINUE, RESET, XCT, EXAMINE,
      EXAMINE NEXT, DEPOSIT and DEPOSIT NEXT through shared controls.
      Audit precise hardware semantics and address wraparound.
- [ ] Complete READ IN (currently cosmetic), paging-aware examine/
      deposit, address break/stop, instruction stepping and operating
      switch effects. Verify the data lights against hardware semantics.
- [ ] Fix browser REBOOT referring to undefined boot(); provide correct
      bootstrap/reset behavior without duplicate execution loops.
- [ ] Centralize CPU scheduling: prevent duplicate main() callbacks
      across start/continue/reset, pending DMA and disconnect/reconnect;
      halt at instruction boundaries and handle outstanding I/O safely.
- [ ] Sample panel state at a bounded rate (initial target 20-30 Hz),
      avoid per-instruction network messages; preserve throughput.
- [ ] Forward CTY input/output, reuse VT52 handling in browser, preserve
      CLI operation when browser disconnects. Define input ownership
      if multiple clients or local terminal are connected.
- [ ] Default network listener to loopback; validate requests, restrict
      control access, bound buffers and avoid exposing arbitrary memory
      or host files through a remote interface.
- [ ] Add panel protocol/state-transition and scheduling regressions;
      verify original browser graphics and Node-backed browser mode.

## 5. Priority 3: configurable physical memory and host efficiency

- [ ] Provide configurable installed core size in words/pages, including
      realistic small KI10/DAIMOS configurations; retain default
      compatibility until smaller configurations pass.
- [ ] Centralize installed-memory bounds for CPU, DMA and panel access;
      implement architectural NXM and page-fault handling.
- [ ] Benchmark current Array against Float64Array and other exact
      representations using RSS, CPU throughput and real boot time.
      Do not assume typed arrays reduce memory without measurement.
- [ ] Keep 36-bit precision; avoid JavaScript 32-bit truncation.
- [ ] Bound media cache memory, distinguish clean and dirty blocks,
      avoid unnecessary copies and allocations in instruction hot paths.
- [ ] Measure each optimization with unchanged guest results.

## 6. Priority 4: persistent storage and existing devices

- [ ] Add explicit writable disk mode or versioned copy-on-write media;
      keep original reference images read-only by default.
- [ ] Implement dirty-block writeback, flush/close, error handling and
      restart persistence; verify guest writes via controller DMA.
- [ ] Bound image/cache accesses to actual configured disk geometry;
      audit short images, EOF, transfer completion and read/compare.
- [ ] Complete RP03 verify/header operations, controller error flags,
      attention, seek and interrupt timing against hardware references.
- [ ] Test disk read/write, multi-block DMA, NXM, error recovery,
      cache eviction and restart persistence; rerun real TOPS-10.
- [ ] Restore guest LPT dispatcher only after validating controller
      semantics. Current --printer option is only a host callback;
      README/help should not imply guest printing is operational.
- [ ] Complete and test TM10B read/compare/positioning, write protection,
      writing and tape marks using real SIMH images.
- [ ] Reconcile README/help disk unit range with actual online drives.
- [ ] Test browser media access separately; retain existing browser
      compatibility and avoid requiring an HTTP server in native mode.

## 7. Priority 5: additional hardware (after correctness gates)

- [ ] DECtape: high priority for DAIMOS; implement the appropriate
      historical controller and tape format with real guest tests.
- [ ] Type 340 vector display: model hardware commands and interrupts
      before adding a renderer; use historical documentation.
- [ ] KA10 processor variant: separate architectural differences from
      common instruction/device logic; add original KA10 diagnostics.
- [ ] Evaluate paper tape, drum and other devices only when needed for
      a defined target configuration. Avoid speculative feature creep.
- [ ] Evaluate KL10/KS10, Massbus, multiplexed terminals and networking
      separately; no immediate implementation commitment.

## 8. Development and acceptance policy

- Work in DevSpace under $HOME/git; use $TMPDIR (default $HOME/tmp)
  and versioned names for experiments.
- Fix confirmed CPU/device bugs rather than bypassing guest behavior.
  Investigate failed experiments before discarding their underlying idea.
- Keep code readable, documented and ASCII. Favor low RAM and speed.
- Keep tests in daimos-testkit, durable technical documentation in
  pdp10-doc and this repository-level TODO/status up to date.
- Commit and push small validated changes; use the established Git
  identity and configured GitHub authentication. Keep private
  credentials and disk images out of repository history.
- Do not modify DAIMOS or unrelated working trees for emulator changes.
- Before declaring a stage complete: run relevant focused tests,
  synthetic host regressions, real TOPS-10 acceptance, and applicable
  historical diagnostics; record remaining limitations explicitly.
