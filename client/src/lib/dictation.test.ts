import { describe, expect, it } from "vitest";
import { appendDictatedText, browserSpeechRecognition, dictationErrorMessage } from "./dictation";

describe("local dictation helpers", () => {
  it("appends editable dictated text without replacing existing work", () => {
    expect(appendDictatedText("Existing note", "new words", false)).toBe("Existing note new words");
    expect(appendDictatedText("Existing note", "new words", true)).toBe("Existing note\nnew words");
    expect(appendDictatedText("", "new words", true)).toBe("new words");
  });

  it("recognises standard and WebKit browser speech APIs without requiring a service call", () => {
    const Recognition = class {} as never;
    expect(browserSpeechRecognition({ SpeechRecognition: Recognition } as never)).toBe(Recognition);
    expect(browserSpeechRecognition({ webkitSpeechRecognition: Recognition } as never)).toBe(Recognition);
    expect(browserSpeechRecognition({} as never)).toBeUndefined();
  });

  it("gives a plain-English permission fallback", () => {
    expect(dictationErrorMessage("not-allowed")).toContain("Microphone access was not allowed");
    expect(dictationErrorMessage("no-speech")).toContain("No speech was detected");
  });
});
