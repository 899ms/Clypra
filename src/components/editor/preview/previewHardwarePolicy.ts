import type { NativeQualityTier } from "@/lib/platform/nativeCore";

/**
 * A conservative preview-only policy for GPU tiers established by production
 * telemetry. It never affects source media or export settings.
 *
 * Intel HD 520 cannot sustain a 4K HEVC editor preview. UHD 630 is viable at
 * 1080p but shows sustained compose/drop pressure at 4K. Other adapters keep
 * the user's selected quality until measured backpressure asks for more.
 */
export interface PreviewHardwarePolicy {
  capabilityPolicy: "full" | "reduced" | "proxy";
  maxDimension?: number;
  maximumQuality?: NativeQualityTier;
}

const FULL_POLICY: PreviewHardwarePolicy = { capabilityPolicy: "full" };

export function selectPreviewHardwarePolicy(
  adapterName: string | null | undefined,
  canvasWidth: number,
  canvasHeight: number,
): PreviewHardwarePolicy {
  const maxCanvasDimension = Math.max(canvasWidth, canvasHeight);
  if (maxCanvasDimension < 3_500 || !adapterName) return FULL_POLICY;

  const adapter = adapterName.toLowerCase();
  if (/intel.*(?:hd graphics )?(?:5[0-9]0|520)/.test(adapter)) {
    return {
      capabilityPolicy: "proxy",
      maxDimension: 1_280,
      maximumQuality: "proxy",
    };
  }

  if (/intel.*uhd graphics 630/.test(adapter)) {
    return {
      capabilityPolicy: "reduced",
      maxDimension: 1_920,
      maximumQuality: "half",
    };
  }

  return FULL_POLICY;
}

export function applyPreviewHardwarePolicy(
  width: number,
  height: number,
  quality: NativeQualityTier,
  policy: PreviewHardwarePolicy,
): { width: number; height: number; quality: NativeQualityTier } {
  const maxDimension = policy.maxDimension;
  const scale = maxDimension
    ? Math.min(1, maxDimension / Math.max(width, height))
    : 1;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    quality: policy.maximumQuality ?? quality,
  };
}
