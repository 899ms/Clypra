import { describe, expect, it } from "vitest";
import {
  applyPreviewHardwarePolicy,
  PreviewPerformancePolicyController,
  selectPreviewHardwarePolicy,
} from "../previewHardwarePolicy";

describe("preview hardware policy", () => {
  it("uses a proxy-sized preview for 4K Intel HD 520", () => {
    const policy = selectPreviewHardwarePolicy(
      "Intel(R) HD Graphics 520",
      3840,
      2160,
    );
    expect(policy.capabilityPolicy).toBe("proxy");
    expect(applyPreviewHardwarePolicy(3840, 2160, "full", policy)).toEqual({
      width: 1280,
      height: 720,
      quality: "proxy",
    });
  });

  it("uses a proxy-sized preview for 4K Intel UHD 630", () => {
    const policy = selectPreviewHardwarePolicy(
      "Intel(R) UHD Graphics 630",
      3840,
      2160,
    );
    expect(policy.capabilityPolicy).toBe("proxy");
    expect(applyPreviewHardwarePolicy(3840, 2160, "full", policy)).toEqual({
      width: 1280,
      height: 720,
      quality: "proxy",
    });
  });

  it("does not constrain modern Intel or sub-4K previews", () => {
    expect(
      selectPreviewHardwarePolicy("Intel(R) Iris(R) Xe Graphics", 3840, 2160),
    ).toEqual({ capabilityPolicy: "full" });
    expect(
      selectPreviewHardwarePolicy("Intel(R) HD Graphics 520", 1920, 1080),
    ).toEqual({ capabilityPolicy: "full" });
  });

  it("steps down modern integrated Intel after a bounded miss burst", () => {
    const controller = new PreviewPerformancePolicyController();
    for (let index = 0; index < 12; index += 1) {
      controller.observe({ totalTimeUs: index < 3 ? 20_000 : 10_000, dropped: false });
    }
    expect(
      controller.policyFor("Intel(R) Iris(R) Xe Graphics", 3840, 2160),
    ).toMatchObject({ capabilityPolicy: "reduced", maximumQuality: "half" });
  });

  it("does not react to isolated cold frames", () => {
    const controller = new PreviewPerformancePolicyController();
    for (let index = 0; index < 60; index += 1) {
      controller.observe({ totalTimeUs: index === 0 ? 100_000 : 10_000, dropped: false });
    }
    expect(
      controller.policyFor("Intel(R) Iris(R) Xe Graphics", 3840, 2160),
    ).toEqual({ capabilityPolicy: "full" });
  });
});
