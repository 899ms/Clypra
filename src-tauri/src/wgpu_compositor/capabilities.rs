use serde::{Deserialize, Serialize};

/// High-level frame render path chosen by the preview pipeline.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum FrameRenderPath {
    /// Optimal zero-copy path: D3D11VA -> DXGI NT shared handle -> wgpu HAL texture (VRAM only).
    ZeroCopyDxgi,
    /// Direct DMA upload path: Hardware or software decode -> CPU-accessible NV12 -> YUV ring buffer -> wgpu texture.
    GpuUploadRing,
    /// Software decode or CPU readback compatibility path.
    CpuFallback,
}

/// Dynamic runtime state of the DXGI zero-copy import path for the current preview session.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum DxgiImportState {
    /// Initial state: capabilities permit DXGI zero-copy, but no frame has been imported yet.
    Unknown,
    /// Zero-copy DXGI import has succeeded and is active for the session.
    Supported,
    /// DXGI zero-copy is disabled by capability negotiation or environment override.
    Disabled,
    /// A runtime error occurred during import or render; sticky latching prevents repeated attempts.
    Failed,
}

/// Explicit negotiated capabilities for the Clypra preview rendering engine.
/// Evaluated once upon GPU context initialization rather than ad-hoc checks per frame.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PreviewCapabilities {
    /// Adapter and device support wgpu::Features::TEXTURE_FORMAT_NV12.
    pub wgpu_nv12: bool,
    /// Hardware, driver, OS, and configuration support zero-copy D3D11VA -> DXGI -> wgpu texture import.
    pub dxgi_import_capable: bool,
    /// Hardware video decode is available and enabled.
    pub hw_decode: bool,
    /// Native surface presentation is supported.
    pub native_surface: bool,
    /// HDR / 10-bit color pipelines are supported.
    pub hdr: bool,
}

impl PreviewCapabilities {
    /// Evaluate rendering capabilities for the selected GPU adapter and environment.
    pub fn negotiate(
        adapter_features: &wgpu::Features,
        #[allow(unused_variables)]
        backend_name: &str,
    ) -> Self {
        let renderer_override = std::env::var("CLYPRA_RENDERER")
            .unwrap_or_else(|_| "auto".into())
            .to_lowercase();
        let force_cpu = renderer_override == "cpu";
        #[allow(unused_variables)]
        let disable_dxgi = force_cpu
            || std::env::var("CLYPRA_DISABLE_DXGI").as_deref() == Ok("1")
            || std::env::var("CLYPRA_DISABLE_DXGI_ZERO_COPY").as_deref() == Ok("1");
        let disable_hw_decode = force_cpu
            || std::env::var("CLYPRA_DISABLE_HW_DECODE").as_deref() == Ok("1");

        let wgpu_nv12 = adapter_features.contains(wgpu::Features::TEXTURE_FORMAT_NV12);

        #[cfg(target_os = "windows")]
        let dxgi_import_capable = !disable_dxgi
            && backend_name.to_lowercase().contains("dx12")
            && wgpu_nv12;

        #[cfg(not(target_os = "windows"))]
        let dxgi_import_capable = false;

        let hw_decode = !disable_hw_decode;
        let native_surface = true;
        let hdr = adapter_features.contains(wgpu::Features::TEXTURE_FORMAT_16BIT_NORM);

        Self {
            wgpu_nv12,
            dxgi_import_capable,
            hw_decode,
            native_surface,
            hdr,
        }
    }
}

/// Explicit errors that can occur during preview frame rendering.
#[derive(Debug, Clone)]
pub enum PreviewRenderError {
    UnsupportedFormat(String),
    UnsupportedFeature(String),
    ImportFailed(String),
    RenderFailed(String),
    PipelineError(String),
}

impl std::fmt::Display for PreviewRenderError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::UnsupportedFormat(msg) => write!(f, "Unsupported format: {msg}"),
            Self::UnsupportedFeature(msg) => write!(f, "Unsupported feature: {msg}"),
            Self::ImportFailed(msg) => write!(f, "DXGI import failed: {msg}"),
            Self::RenderFailed(msg) => write!(f, "Render pass failed: {msg}"),
            Self::PipelineError(msg) => write!(f, "Pipeline error: {msg}"),
        }
    }
}

impl std::error::Error for PreviewRenderError {}
