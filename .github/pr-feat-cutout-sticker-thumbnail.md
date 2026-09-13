feat: Text Behind Person, off-thread sticker rasterizer, thumbnail improvements
---
## Overview

Three interconnected features shipped in this branch:

1. **"Text Behind Person"** — AI-powered subject cutout that composites text layers visually behind the foreground person using body segmentation and GPU masking
2. **Off-thread Lottie sticker rasterizer** — Web Worker with OffscreenCanvas eliminates UI thread freezes during animated sticker playback
3. **Thumbnail workspace improvements** — export enhancements and UX polish

---

## Feature 1 — Text Behind Person (Subject Cutout)

### Problem
Text overlays always rendered on top of the person in the video frame. No way to place text behind the subject without manual green-screen work.

### Solution
When a text clip has `behindSubject: true`, the evaluator synthesizes a synthetic `:subject-cutout` video layer at `zIndex = text.zIndex + 0.5`. This layer runs through AI body segmentation and the GPU compositor applies a feathered mask that cuts out the foreground subject, revealing the text underneath.

### Changes

**`src-tauri/src/shaders/multi_track_blend.wgsl`**
- Add body effect type 4 (`body_cutout` / subject isolation) to the WGSL fragment shader
- Types 1–3 (outline, glow, particles) now use explicit range guards to avoid misclassifying type 4
- Cutout path: `smoothstep` feathering from `params.z` (default 4px) applied to segmentation mask alpha; sub-threshold pixels discarded
- Fix: `keyed_color` declared `var` (was `let`) to allow alpha mutation

**`src-tauri/src/wgpu_compositor.rs`**
- Add `transparent_mask_placeholder` (1×1 transparent texture) and `mask_registration_history` (`HashSet`) to `NativePreviewSession`
- Grow `RGBA_LAYER_CACHE_BYTES` from 128 MB → 384 MB to accommodate concurrent body-mask textures

**`src/core/evaluation/evaluator.ts`**
- Step 3.1: detect `behindSubject=true` clips, synthesize `:subject-cutout` layers at `zIndex = text.zIndex + 0.5` for each underlying media layer the text overlaps
- Cutout layer inherits base media but gains a `body_cutout` effect with configurable feather

**`src-tauri/src/commands/native_preview.rs` / `native_playback.rs`**
- Skip `:subject-cutout` layers when opening decode streams (no redundant decoder instances)
- Playback demand reconciliation: handle dynamic cutout add/removal without strict layer-count equality; construct missing cutout layers from base layer

**`src/core/playback/cutoutPipelineTrace.ts`** *(new)*
- Structured per-stage trace logger (eval → source → segment → bridge → request → backend) writing to `perfLogService` for post-session diagnostics

**`src/components/editor/properties/TextStyleSection.tsx`**
- Add "Behind Subject" toggle (`behindSubject`) and "Edge Softness" slider (`subjectFeather`) with purple accent styling

**`src/components/editor/timeline/Clip.tsx`**
- Render a "Behind" badge on timeline clips with `behindSubject=true`

**`src/lib/platform/nativeCore.ts`**
- Add `body_cutout` and `subject_cutout` to `NativeBodyEffectSnapshot.renderer` union
- Add `layerId`, `colorGrade`, `bodyEffect` to `NativePlaybackFrameDemand` video layer update struct

**`src/types/index.ts`**
- Add `behindSubject?: boolean` and `subjectFeather?: number` to `Clip` interface

---

## Feature 2 — Off-thread Lottie Sticker Rasterizer

### Problem
Animated Lottie stickers were rasterized on the main JS thread during playback — causing UI freezes, GC pauses, and dropped frames every time a sticker frame was evaluated.

### Solution
A dedicated Web Worker renders Lottie frames to `OffscreenCanvas` and transfers the `ImageData` buffer zero-copy back to the main thread. The main thread never blocks on Lottie evaluation.

### Changes

**`src/workers/stickerRasterizer.worker.ts`** *(new)*
- Loads Lottie dynamically in Worker context
- Handles `RENDER_STICKER_FRAME` messages: seeks animation, rasterizes to `OffscreenCanvas`, transfers `ImageData.data.buffer` zero-copy

**`src/workers/workerDomShim.ts`** *(new)*
- Minimal `document`/`window` stubs required by Lottie's web bundle inside a Worker context

**`src/core/render/stickerRasterizerWorkerClient.ts`** *(new)*
- Façade over worker lifecycle: in-flight deduplication by raster key, GPU residency fast-path (skip rasterization for already-cached frames), transparent main-thread fallback when `Worker`/`OffscreenCanvas` unavailable
- Replaces `NativeAnimatedStickerRenderer` in `NativeRasterBridge`
- Emits structured sticker telemetry samples to `telemetryCollector`

**`src/core/render/nativeRasterBridge.ts`**
- Swap `NativeAnimatedStickerRenderer` → `StickerRasterizerWorkerClient`
- Add `nonBlockingStickers` flag: playback uses latest prepared snapshot while worker rasterizes in background (mirrors existing `nonBlockingText`)
- Export `NativeRasterBridgeOptions` interface

**`src/features/body-effects/segmentation/bodySegmentationWorkerClient.ts`**
- Per-clip dispatch queue: supersede stale pending segmentation tasks instead of queuing unbounded work
- Clamp source dimensions to `MAX_SEGMENTATION_DIM` (512px) before worker dispatch
- Export `createCutoutCanvas()` for subject-cutout preview compositing
- Add segmentation timing and subject coverage telemetry

**`src/services/telemetryCollector.ts`**
- Add `sticker` subsystem: `TelemetryStickerFormat`, `TelemetryStickerPhase`, `TelemetryStickerOperation`, `TelemetryStickerMetrics` types
- Add `recordStickerRender()` accumulator method

---

## Feature 3 — Thumbnail Workspace Improvements

**`ThumbnailOverlayEditor.tsx`** — improved overlay layer text editing and positioning controls

**`ThumbnailWorkspace.tsx`** — export status feedback and loading states

**`thumbnailExport.ts`** — extended platform preset coverage, better JPEG quality defaults, error handling for missing canvas context

**`useThumbnailWorkspace.ts`** — variant duplication and timestamp snapping helpers

---

## Plumbing & Fixes

**`src/lib/platform/tauri.ts`**
- Add `listenForNativeMaskEviction()` and `listenForNativeRasterEviction()` for out-of-band GPU texture eviction events from the Rust compositor

**`src/lib/timeline/placementEngine.ts`**
- Register media asset in `projectStore` before timeline placement
- Prewarm sticker clip immediately after add via `getActiveSessionOrNull()`

**`src-tauri/src/diagnostics.rs`**
- Add `pub fn info()` alongside existing `warn()` for structured info-level diagnostics

**`src/services/perfLogService.ts`**
- Add `sticker-render` to `PerfLogKind` union

---

## Tests

| File | Status |
|---|---|
| `behindSubjectLayerSynthesis.test.ts` | New |
| `cutoutPipelineTrace.test.ts` | New |
| `stickerRasterizerWorkerClient.test.ts` | New |
| `nativeRasterBridge.test.ts` | Updated |
| `nativeVideoPreview.test.ts` | Updated |
| `nativePlaybackSnapshot.test.ts` | Updated |

---

## Commit Map

| Commit | Description |
|---|---|
| `1ff39998` | `feat(compositor)` — body_cutout WGSL shader + 384MB RGBA cache |
| `a443b657` | `feat(cutout)` — "Text Behind Person" end-to-end pipeline |
| `7f581208` | `feat(sticker)` — off-thread Lottie rasterizer worker + telemetry |
| `119f01a3` | `feat(thumbnail)` — workspace UX improvements and export enhancements |
| `532d9bc6` | `fix/feat` — eviction listeners, diagnostics info, video preview wiring |
