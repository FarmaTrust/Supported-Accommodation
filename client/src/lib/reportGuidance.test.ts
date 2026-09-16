import { describe, expect, it } from "vitest";
import { dictationUnavailableMessage, reportPromptFields } from "./reportGuidance";

describe("guided Key Worker reporting", () => {
  it("includes the requested factual report prompts", () => {
    expect(reportPromptFields.map(field => field.key)).toEqual(expect.arrayContaining(["mood", "attitude", "learning", "enthusiasm", "discussions", "plan"]));
  });

  it("does not imply a dictation service is available when the browser lacks speech input", () => {
    expect(dictationUnavailableMessage()).toMatch(/not available in this browser/i);
  });
});
