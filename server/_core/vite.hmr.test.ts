import { describe, expect, it } from "vitest";
import { getManagedPreviewHmrClientOptions } from "./vite";

describe("managed preview HMR options", () => {
  it("uses the public HTTPS WebSocket port for a managed preview", () => {
    expect(getManagedPreviewHmrClientOptions(true)).toEqual({ protocol: "wss", clientPort: 443 });
  });

  it("leaves local development on the same server defaults", () => {
    expect(getManagedPreviewHmrClientOptions(false)).toEqual({});
  });
});
