/**
 * Body Effects Feature
 * Public exports for ML-powered body segmentation effects
 */

export { segmentBodyMask, makeBodyMaskCacheKey, createCutoutCanvas } from "./segmentation/bodySegmentationWorkerClient";
export { bodyMaskCache, BodyMaskCache } from "./segmentation/maskCache";

export type { BodySegmentationOptions, BodySegmentationRequest, BodySegmentationResponse } from "./segmentation/types";
