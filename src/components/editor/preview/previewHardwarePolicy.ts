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

export interface PreviewPerformanceObservation {
  totalTimeUs: number;
  dropped: boolean;
}

/**
 * Session-scoped backpressure policy for integrated Intel graphics. It moves
 * down one rung only after a sustained bad window, avoiding a quality change
 * for a single cold frame or a brief resize. It deliberately never upscales
 * again mid-session: stable editing is more valuable than oscillating detail.
 */
export class PreviewPerformancePolicyController {
  private observations: PreviewPerformanceObservation[] = [];
  private escalation = 0;

  observe(observation: PreviewPerformanceObservation): boolean {
    this.observations.push(observation);
    if (this.observations.length > 60) this.observations.shift();
    if (this.observations.length < 30 || this.escalation >= 2) return false;

    const overloaded = this.observations.filter(
      (sample) => sample.dropped || sample.totalTimeUs > 16_667,
    ).length;
    if (overloaded < 3) return false;

    this.escalation += 1;
    this.observations = [];
    return true;
  }

  policyFor(adapterName: string | null | undefined, canvasWidth: number, canvasHeight: number): PreviewHardwarePolicy {
    const baseline = selectPreviewHardwarePolicy(adapterName, canvasWidth, canvasHeight);
    if (!adapterName || Math.max(canvasWidth, canvasHeight) < 3_500) return baseline;
    if (!/intel/i.test(adapterName)) return baseline;

    const adapter = adapterName.toLowerCase();
    // Legacy HD is already at the strongest safe policy.
    if (/intel.*(?:hd graphics )?(?:5[0-9]0|520)/.test(adapter)) return baseline;
    if (this.escalation === 0) return baseline;
    if (this.escalation === 1) {
      return baseline.capabilityPolicy === "full"
        ? { capabilityPolicy: "reduced", maxDimension: 1_920, maximumQuality: "half" }
        : { capabilityPolicy: "proxy", maxDimension: 1_280, maximumQuality: "proxy" };
    }
    return { capabilityPolicy: "proxy", maxDimension: 1_280, maximumQuality: "proxy" };
  }
}

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
