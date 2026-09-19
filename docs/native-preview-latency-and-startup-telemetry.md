# Native Preview Latency and Startup Telemetry

**Status:** Implemented September 2026  
**Scope:** Native program preview on Windows, macOS, and other supported desktop platforms.

## Purpose

This document records the architectural response to a Windows first-playback regression in v1.5.1. The preview initially appeared blank or extremely slow, then became substantially faster when replayed in the same process.

The implementation separates two independent concerns:

1. Decode-ahead must not create visible playback latency by filling a large ready-frame queue.
2. First-use GPU/session initialization must be measurable separately from media decode and normal frame presentation.

## Evidence

The affected Windows Intel v1.5.1 session showed a high queue-hit rate but poor visible playback:

| Metric | Observed result |
| --- | --- |
| Ready-frame queue residency, p50 | ~364 ms |
| Ready-frame queue residency, p95 | ~482 ms |
| Ready-frame queue residency, max | ~545 ms |
| Queue capacity | 24 frames |
| Cold-frame p95 | ~1.4 s |
| Cold-frame max | ~10 s |

This ruled out a simple “cache miss” explanation. Frames were decoded and available, but the old fixed 16-frame lookahead policy could place them up to 16 frame intervals ahead of the playhead. At 30 fps that is approximately 533 ms of policy-created latency.

The cold outliers also could not be attributed to a single stage from the old logs. For example, the longest sample had small decode/upload/present timings while total wall time was nearly ten seconds. This requires an explicit startup/initialization measurement rather than treating all delay as FFmpeg work.

## Architecture

### Startup readiness gate

Native preview has a strict startup order:

```text
surface configured → playback snapshot configured → GPU graph prepared
→ bounded decoder queue primed → render worker / audio-driven presentation
```

Pipeline warmup is no longer launched from native-surface configuration or as
a second best-effort task from playback configuration. Those two independent
tasks could both acquire `NativePreviewSession` while a visible frame waited
for the same lock. That race was tolerable on Apple Silicon but produced
multi-second `coldStartInitUs` delays on the Intel HD 520 Windows cohort.

`prepare_native_preview_pipelines` is now awaited during
`configure_native_playback_render`, before its render worker is started or its
lookahead queue is primed. The session-owned compositor cache makes repeated
preparation for the same canvas and target format a no-op. GPU initialization
is consequently a readiness prerequisite rather than work that races audio
and visible presentation.

If GPU preparation cannot complete because the native GPU session is absent or
invalid, playback configuration returns an explicit error. The frontend can
then use its established native-surface fallback path; it must not start an
audio clock against a blank native surface.

### Deadline-aware decode ahead

`NativePreviewFrameQueue` records an EWMA of completed decode duration. Each lookahead worker derives its depth from both this measured lead requirement and a presentation-latency cap:

```text
effective lookahead = min(
  configured lookahead,
  frames fitting in 100 ms,
  frames needed to cover measured decode duration
)
```

At 30 fps, the 100 ms cap permits at most three frames ahead of the playhead. A decoder needing about 40 ms of lead uses two frames; a slower decoder remains capped at three. The configured value remains an upper bound only—it is not a latency target.

The worker also re-reads the audio clock before each decode. If its target frame is already behind the live playhead, it skips that decode instead of adding obsolete work. When a visible presentation arrives, the queue removes frames more than two frames behind the requested frame; two frames remain only for the intentional closest-frame fallback.

These invariants preserve strictly forward decoding and avoid competing backward FFmpeg seeks while preventing the queue from becoming a latency buffer.

### Cold-start timing

Visible native surface presentation now measures:

- session mutex wait before GPU work;
- compositor graph creation / pipeline initialization time;
- their combined `coldStartInitUs` only when a visible frame pays an initialization cost.

Normal short-lived mutex contention is not reported as cold start. A first use of a compositor or a wait of at least 1 ms is reported so the telemetry identifies startup contention without distorting steady-state stage metrics.

The existing pipeline warmup remains independent. The new field makes it possible to prove whether warmup completed before the first visible frame or blocked it.

## Telemetry contract

Two optional microsecond fields are propagated from Rust through the Tauri contract, frontend rollups, session NDJSON, and API analytics:

| Field | Meaning | Interpretation |
| --- | --- | --- |
| `queueResidencyUs` | Time between a lookahead frame becoming ready and being presented | High values indicate excessive decode-ahead or stale queued work, not decoder speed. |
| `coldStartInitUs` | One-time visible-path session wait plus compositor initialization | High values indicate startup/pipeline/session initialization blocking. |

Both fields have mean and percentile rollups. They are intentionally optional because steady-state frames should not be classified as startup work, and cold-decoded frames have no ready-queue residence.

The native preview and playback hot paths do not write per-frame or lifecycle
diagnostics to the terminal. These fields are emitted through native
performance samples, frontend rollups, session NDJSON, and API analytics
instead, preventing stdout/stderr backpressure from becoming a Windows preview
variable.

The Cloudflare API schema and preview comparison analytics also recognize both fields. This permits cohort analysis across Windows Intel and macOS Apple Silicon without relying on untyped raw JSON.

## Files changed

| Area | Files |
| --- | --- |
| Lookahead policy, stale-frame eviction, native log output | `src-tauri/src/commands/native_preview.rs` |
| Native performance sample and percentile aggregation | `src-tauri/src/native_core/performance.rs`, `src-tauri/src/native_core/service.rs` |
| Native-surface response contract | `src-tauri/src/native_core/surface.rs` |
| Compositor warm-state inspection + Windows Bgra8UnormSrgb pre-warm | `src-tauri/src/wgpu_compositor.rs` |
| TypeScript native bridge and session rollups | `src/lib/platform/nativeCore.ts`, `src/services/telemetryCollector.ts` |
| API schema and comparison analytics | sibling `clypra-api/src/types/performance.ts`, `clypra-api/src/services/analyticsEngine.ts` |

## Verification

Run from the Clypra repository:

```bash
cargo check --manifest-path src-tauri/Cargo.toml
npm run typecheck
cargo test --manifest-path src-tauri/Cargo.toml \
  commands::native_preview::tests::lookahead_is_bounded_by_the_presentation_latency_budget \
  -- --exact
```

Run from the sibling API repository:

```bash
npm run typecheck
npm test -- --runInBand src/__tests__/performance.test.ts
```

The focused Rust regression test verifies that a configured 16-frame queue resolves to two frames for a 40 ms decoder at 30 fps, and never exceeds three frames even for a much slower decoder.

## Windows validation procedure

1. Start a fresh Windows dev session, import the affected MP4, and play immediately.
2. Collect the first cold frame and at least 30 seconds of playback telemetry.
3. Compare the first run with a replay in the same process.
4. Inspect the following in order:
   - `coldStartInitUs` for first-frame/session startup blocking;
   - `queueResidencyUs` p50/p95 for policy-created latency;
   - decode and decoder mutex timings for FFmpeg/GOP behavior;
   - upload, compose, surface acquisition, and present timings for GPU bottlenecks.

Expected result after the Bgra8UnormSrgb warmup fix: `coldStartInitUs` should be absent or under 200 ms on the first native frame (matching the macOS ~120 ms baseline). Any remaining first-run stall should be attributed to a different measured stage, not compositor pipeline compilation.

## v1.5.1 session analysis

Four sessions were analyzed from DB + R2 telemetry (September 2026):

| Session | Platform | `coldStartInitUs` (first occurrence) | Cause |
| --- | --- | --- | --- |
| `launch-1789807958711-p4yoli` | Windows Intel HD 520 | **4,963 ms** | Bgra8UnormSrgb compositor compiled synchronously inside Frame 2 presentation |
| `launch-1789807298689-5csq0k` | macOS Apple M1 | **120 ms** | Normal first-use Metal pipeline initialization |

The root cause on Windows: `configure_native_playback_render` calls `prepare_native_preview_pipelines` before the swapchain has set `configured_format()`, so it warms `Rgba8UnormSrgb`. When the native surface presents Frame 2 it uses `Bgra8UnormSrgb` (the DXGI swapchain default), finds no compositor cached for that format, and compiles all five D3D12 pipelines synchronously while holding the session mutex — blocking the decoder thread for 536 ms and producing 4.96 s of presentation latency.

The fix (`#[cfg(target_os = "windows")]` block in `warmup_gpu_pipelines` and `prepare_native_preview_pipelines`) pre-compiles `Bgra8UnormSrgb` during the readiness gate, regardless of the format passed by the caller. `has_compositor` makes subsequent calls no-ops.

## Non-goals

- This change does not claim that every initial decode is fast; long GOP media can still require a cold decode.
- It does not hide startup latency with a placeholder frame.
- It does not alter media decoding correctness, FFmpeg binaries, or native-surface fallback policy.

Its purpose is to eliminate queue-created and compositor-compilation latency and make remaining cold-start delay diagnosable with durable, cross-platform telemetry.
