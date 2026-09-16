export type BrowserSpeechWindow = Window & {
  SpeechRecognition?: new () => SpeechRecognitionInstance;
  webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
};

export type SpeechRecognitionInstance = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onstart: (() => void) | null;
  onresult: ((event: { results: ArrayLike<{ 0?: { transcript?: string } }> }) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop?: () => void;
};

export function browserSpeechRecognition(windowObject: BrowserSpeechWindow) {
  return windowObject.SpeechRecognition ?? windowObject.webkitSpeechRecognition;
}

export function appendDictatedText(current: string, transcript: string, multiline: boolean) {
  const cleanedTranscript = transcript.trim();
  if (!cleanedTranscript) return current;
  const existing = current.trimEnd();
  if (!existing) return cleanedTranscript;
  return `${existing}${multiline ? "\n" : " "}${cleanedTranscript}`;
}

export function dictationErrorMessage(error?: string) {
  if (error === "not-allowed" || error === "service-not-allowed") {
    return "Microphone access was not allowed. Enable it in your browser settings, then try again or type the text.";
  }
  if (error === "no-speech") {
    return "No speech was detected. Try again, or type the text directly.";
  }
  return "Dictation could not be started. Check microphone permission, then try again or type the text.";
}

export const dictationReviewMessage = "Dictation adds editable text to this field only. Review spelling, factual accuracy and wording before saving or submitting.";
