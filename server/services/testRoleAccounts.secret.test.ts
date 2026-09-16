import { describe, expect, it } from "vitest";
import { hashLocalPassword, validateLocalPassword, verifyLocalPassword } from "./localAuth";

describe("managed TEST account configuration", () => {
  it("accepts the managed temporary password through the same hash and verification flow used by local sign-in", async () => {
    const password = process.env.TEST_USER_INITIAL_PASSWORD;
    expect(password).toBeTruthy();
    expect(validateLocalPassword(password!)).toBeNull();
    const hash = await hashLocalPassword(password!);
    expect(await verifyLocalPassword(password!, hash)).toBe(true);
  });

  it("uses an HTTPS same-application base for reset links", () => {
    expect(process.env.APP_PUBLIC_URL).toMatch(/^https:\/\/supacchub-gwzopgtf\.manus\.space$/);
  });
});
