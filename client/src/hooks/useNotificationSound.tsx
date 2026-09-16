import { Button } from "@/components/ui/button";
import { newUnreadNotificationIds, type SoundNotification } from "@/lib/notificationSound";
import { Volume2, VolumeX } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

const STORAGE_KEY = "supported-accommodation-hub-notification-sound";

type BrowserAudioContext = typeof AudioContext;

function audioContextConstructor(): BrowserAudioContext | undefined {
  if (typeof window === "undefined") return undefined;
  return window.AudioContext ?? (window as Window & { webkitAudioContext?: BrowserAudioContext }).webkitAudioContext;
}

async function playPing(context: AudioContext) {
  if (context.state === "suspended") await context.resume();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(880, context.currentTime);
  oscillator.frequency.exponentialRampToValueAtTime(1320, context.currentTime + 0.08);
  gain.gain.setValueAtTime(0.0001, context.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.085, context.currentTime + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.16);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + 0.18);
}

export function useNotificationSound(items: SoundNotification[] | undefined) {
  const [enabled, setEnabled] = useState(() => typeof window !== "undefined" && window.localStorage.getItem(STORAGE_KEY) === "enabled");
  const priorUnreadIds = useRef<number[] | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const idsKey = useMemo(() => items ? items.filter(item => !item.readAt).map(item => item.id).sort((left, right) => left - right).join(",") : "loading", [items]);

  useEffect(() => {
    if (!items) return;
    const { current, added } = newUnreadNotificationIds(priorUnreadIds.current, items);
    priorUnreadIds.current = current;
    if (!enabled || !added.length || !contextRef.current) return;
    void playPing(contextRef.current).catch(() => undefined);
  }, [enabled, idsKey, items]);

  const toggle = async () => {
    const next = !enabled;
    if (next) {
      const AudioContextConstructor = audioContextConstructor();
      if (!AudioContextConstructor) return;
      const context = contextRef.current ?? new AudioContextConstructor();
      contextRef.current = context;
      try { if (context.state === "suspended") await context.resume(); }
      catch { return; }
    }
    setEnabled(next);
    window.localStorage.setItem(STORAGE_KEY, next ? "enabled" : "disabled");
  };

  return { enabled, supported: Boolean(audioContextConstructor()), toggle };
}

export function NotificationSoundControl({ enabled, supported, onToggle }: { enabled: boolean; supported: boolean; onToggle: () => void }) {
  if (!supported) return null;
  return <Button type="button" variant="outline" size="icon" className="h-10 w-10 shrink-0 rounded-xl bg-card" onClick={() => void onToggle()} aria-label={enabled ? "Turn notification sound off" : "Turn notification sound on"} aria-pressed={enabled} title={enabled ? "Notification sound on" : "Notification sound off"}>{enabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}</Button>;
}
