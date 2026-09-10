import { describe, expect, it } from "vitest";
import { getSafeClientErrorCode } from "./ErrorBoundary";

describe("safe client error feedback", () => {
  it("classifies stale lazy-release failures without returning raw React diagnostics", () => {
    const error = new Error("Lazy element type must resolve to a class or function");
    expect(getSafeClientErrorCode(error)).toBe("APP_RELEASE_REFRESH_REQUIRED");
    expect(getSafeClientErrorCode(new Error("Minified React error #306"))).toBe("APP_RELEASE_REFRESH_REQUIRED");
  });

  it("uses a stable generic code for all other render failures", () => {
    expect(getSafeClientErrorCode(new Error("Unexpected render failure"))).toBe("APP_RENDER_FAILURE");
  });
});
