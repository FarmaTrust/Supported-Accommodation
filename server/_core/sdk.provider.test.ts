import { describe, expect, it } from "vitest";
import { isTemporaryProviderConnectivityError } from "./sdk";

describe("temporary provider connectivity classification", () => {
  it("classifies DNS and transient transport failures without exposing the host to users", () => {
    expect(isTemporaryProviderConnectivityError({ isAxiosError: true, code: "ENOTFOUND" })).toBe(true);
    expect(isTemporaryProviderConnectivityError({ isAxiosError: true, code: "EAI_AGAIN" })).toBe(true);
    expect(isTemporaryProviderConnectivityError({ isAxiosError: true, code: "ETIMEDOUT" })).toBe(true);
  });

  it("does not classify a provider rejection or arbitrary error as an availability outage", () => {
    expect(isTemporaryProviderConnectivityError({ isAxiosError: true, code: "ERR_BAD_REQUEST" })).toBe(false);
    expect(isTemporaryProviderConnectivityError(new Error("unexpected"))).toBe(false);
  });
});
