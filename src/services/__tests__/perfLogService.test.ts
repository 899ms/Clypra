import { describe, it, expect, vi, beforeEach } from "vitest";
import { perfLogService } from "../perfLogService";

describe("PerfLogService Phase 5 Session Telemetry Integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("exports a singleton instance with session lifecycle methods", () => {
    expect(perfLogService).toBeDefined();
    expect(typeof perfLogService.openSession).toBe("function");
    expect(typeof perfLogService.closeAndUpload).toBe("function");
    expect(typeof perfLogService.enqueue).toBe("function");
  });
});
