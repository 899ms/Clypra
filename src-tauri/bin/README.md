# FFmpeg / FFprobe sidecars

Tauri bundles these as `externalBin` entries `bin/ffmpeg` and `bin/ffprobe`. For each host triple you ship, place a **real executable** at:

| Binary  | macOS ARM                      | macOS Intel                   | Linux x86_64                       | Linux ARM64                         | Windows x86_64                       | Windows ARM64                         |
| ------- | ------------------------------ | ----------------------------- | ---------------------------------- | ----------------------------------- | ------------------------------------ | ------------------------------------- |
| ffmpeg  | `ffmpeg-aarch64-apple-darwin`  | `ffmpeg-x86_64-apple-darwin`  | `ffmpeg-x86_64-unknown-linux-gnu`  | `ffmpeg-aarch64-unknown-linux-gnu`  | `ffmpeg-x86_64-pc-windows-msvc.exe`  | `ffmpeg-aarch64-pc-windows-msvc.exe`  |
| ffprobe | `ffprobe-aarch64-apple-darwin` | `ffprobe-x86_64-apple-darwin` | `ffprobe-x86_64-unknown-linux-gnu` | `ffprobe-aarch64-unknown-linux-gnu` | `ffprobe-x86_64-pc-windows-msvc.exe` | `ffprobe-aarch64-pc-windows-msvc.exe` |

The repo ships **small shell/batch wrappers** only for local development. The release pipeline replaces them with SHA-256-verified static binaries before the Tauri bundle is built. `npm run verify:sidecars -- --target <target-triple>` refuses a release artifact if a wrapper, missing file, or wrong executable format remains. For a manual distribution build, run `npm run setup:sidecars -- --target <target-triple>` first, then verify it.

Tauri's `externalBin` configuration places the selected sidecars with the app. The Rust media runtime resolves those target-qualified binaries before consulting `PATH`, so a customer never needs FFmpeg installed separately.

If manually replacing a sidecar with a **static** or **framework-linked** build from a trusted source (e.g. your own build from [ffmpeg.org](https://ffmpeg.org/) or a vetted static bundle), then:

```bash
chmod +x src-tauri/bin/ffmpeg-* src-tauri/bin/ffprobe-*
```

## Compliance

FFmpeg is typically LGPL/GPL depending on enabled codecs. Ensure your **LICENSE** / third-party notices match the binaries you ship.

## Code signing & notarization

Sidecar binaries must be signed and stapled with the same workflow as your main app bundle, or macOS Gatekeeper may block them.
