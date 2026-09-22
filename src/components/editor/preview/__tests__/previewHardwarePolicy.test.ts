import { describe, expect, it } from "vitest";
import {
  applyPreviewHardwarePolicy,
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

  it("uses a 1080p half-quality preview for 4K Intel UHD 630", () => {
    const policy = selectPreviewHardwarePolicy(
      "Intel(R) UHD Graphics 630",
      3840,
      2160,
    );
    expect(policy.capabilityPolicy).toBe("reduced");
    expect(applyPreviewHardwarePolicy(3840, 2160, "full", policy)).toEqual({
      width: 1920,
      height: 1080,
      quality: "half",
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
});
