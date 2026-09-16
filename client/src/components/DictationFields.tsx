import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { appendDictatedText, browserSpeechRecognition, dictationErrorMessage, dictationReviewMessage, type SpeechRecognitionInstance } from "@/lib/dictation";
import { cn } from "@/lib/utils";
import { Mic, Square } from "lucide-react";
import { useRef, useState, type ChangeEvent, type ComponentProps } from "react";
import { toast } from "sonner";

type ControlledTextProps = {
  label?: string;
  onValueChange?: (value: string) => void;
};

type DictationInputProps = Omit<ComponentProps<typeof Input>, "className"> & ControlledTextProps & { className?: string };
type DictationTextareaProps = Omit<ComponentProps<typeof Textarea>, "className"> & ControlledTextProps & { className?: string };

function emitTextChange<T extends HTMLInputElement | HTMLTextAreaElement>(nextValue: string, onChange: ((event: ChangeEvent<T>) => void) | undefined, onValueChange: ((value: string) => void) | undefined) {
  onValueChange?.(nextValue);
  onChange?.({ target: { value: nextValue }, currentTarget: { value: nextValue } } as ChangeEvent<T>);
}

function DictationButton({ label, currentValue, onValueChange, multiline, disabled }: { label: string; currentValue: string; onValueChange: (value: string) => void; multiline: boolean; disabled?: boolean }) {
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);

  const stop = () => recognitionRef.current?.stop?.();
  const start = () => {
    const Recognition = browserSpeechRecognition(window);
    if (!Recognition) {
      toast.error("Dictation is unavailable", { description: "This browser does not offer on-device speech recognition. You can still type and use the browser spell checker." });
      return;
    }

    try {
      const recognition = new Recognition();
      recognitionRef.current = recognition;
      recognition.lang = "en-GB";
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.onstart = () => setListening(true);
      recognition.onresult = event => {
        const transcript = Array.from(event.results).map(result => result[0]?.transcript ?? "").join(" ");
        onValueChange(appendDictatedText(currentValue, transcript, multiline));
      };
      recognition.onerror = event => toast.error("Dictation could not continue", { description: dictationErrorMessage(event.error) });
      recognition.onend = () => { recognitionRef.current = null; setListening(false); };
      recognition.start();
    } catch {
      toast.error("Dictation could not start", { description: dictationErrorMessage() });
      recognitionRef.current = null;
      setListening(false);
    }
  };

  return <>
    <button
      type="button"
      onClick={listening ? stop : start}
      disabled={disabled}
      aria-label={listening ? `Stop dictation for ${label}` : `Dictate ${label}`}
      title={listening ? `Stop dictation for ${label}` : `Dictate ${label}`}
      className={cn("absolute right-2 z-10 grid h-8 w-8 place-items-center rounded-lg border border-border bg-card text-primary shadow-sm transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50", multiline ? "top-2" : "top-1/2 -translate-y-1/2")}
    >
      {listening ? <Square className="h-3.5 w-3.5 fill-current" aria-hidden="true" /> : <Mic className="h-4 w-4" aria-hidden="true" />}
    </button>
    <span className="sr-only" aria-live="polite">{listening ? `Listening for ${label}. ${dictationReviewMessage}` : ""}</span>
  </>;
}

export function DictationInput({ value, onChange, onValueChange, label, className, disabled, spellCheck = true, ...props }: DictationInputProps) {
  const currentValue = typeof value === "string" ? value : "";
  const fieldLabel = label ?? props["aria-label"] ?? props.placeholder ?? "this field";
  const setValue = (nextValue: string) => emitTextChange<HTMLInputElement>(nextValue, onChange, onValueChange);
  return <div className="relative min-w-0"><Input {...props} value={value} disabled={disabled} spellCheck={spellCheck} onChange={event => { onChange?.(event); onValueChange?.(event.target.value); }} className={cn("pr-11 text-left", className)} /><DictationButton label={fieldLabel} currentValue={currentValue} onValueChange={setValue} multiline={false} disabled={disabled} /></div>;
}

export function DictationTextarea({ value, onChange, onValueChange, label, className, disabled, spellCheck = true, ...props }: DictationTextareaProps) {
  const currentValue = typeof value === "string" ? value : "";
  const fieldLabel = label ?? props["aria-label"] ?? props.placeholder ?? "this field";
  const setValue = (nextValue: string) => emitTextChange<HTMLTextAreaElement>(nextValue, onChange, onValueChange);
  return <div className="relative min-w-0"><Textarea {...props} value={value} disabled={disabled} spellCheck={spellCheck} onChange={event => { onChange?.(event); onValueChange?.(event.target.value); }} className={cn("pr-11 text-left", className)} /><DictationButton label={fieldLabel} currentValue={currentValue} onValueChange={setValue} multiline disabled={disabled} /></div>;
}

export function DictationFieldGuidance() {
  return <p className="text-xs leading-5 text-muted-foreground">Use the microphone beside any narrative field to dictate. <strong className="font-semibold text-foreground">Review and amend the editable text, including spelling, before saving or submitting.</strong></p>;
}
