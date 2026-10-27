import { useCallback, useEffect, useRef, useState } from "react";

export type DictationState = "idle" | "listening" | "preview";

/** Silence that ends the dictation. */
const SILENCE_MS = 1500;
/** Seconds the dictated text is shown before it is submitted. */
const PREVIEW_SECONDS = 2;

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onstart: (() => void) | null;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

type SpeechWindow = Window & {
  SpeechRecognition?: new () => SpeechRecognitionLike;
  webkitSpeechRecognition?: new () => SpeechRecognitionLike;
};

const recognitionClass = () =>
  typeof window === "undefined" ? undefined : (window as SpeechWindow).SpeechRecognition ?? (window as SpeechWindow).webkitSpeechRecognition;

/**
 * Voice input with the same flow as the timeline sync: listen until a short silence, show
 * the text with a countdown, then submit it. Editing the text or cancelling stops the countdown.
 */
export function useVoiceDictation({
  lang,
  onText,
  onSubmit,
  onDenied,
}: {
  lang: string;
  onText: (text: string) => void;
  onSubmit: (text: string) => void;
  onDenied: () => void;
}) {
  const [state, setState] = useState<DictationState>("idle");
  const [countdown, setCountdown] = useState(0);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const silenceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const transcriptRef = useRef("");
  const callbacks = useRef({ onText, onSubmit, onDenied });
  useEffect(() => {
    callbacks.current = { onText, onSubmit, onDenied };
  });
  const supported = Boolean(recognitionClass());

  const cancel = useCallback(() => {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    if (silenceRef.current) clearTimeout(silenceRef.current);
    setState("idle");
    setCountdown(0);
  }, []);

  const start = useCallback(() => {
    const Recognition = recognitionClass();
    if (!Recognition) return;
    try {
      const recognition = new Recognition();
      recognition.lang = lang === "es" ? "es-ES" : "en-US";
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.onstart = () => {
        transcriptRef.current = "";
        callbacks.current.onText("");
        setState("listening");
      };
      recognition.onresult = (event) => {
        let transcript = "";
        for (let i = 0; i < event.results.length; i += 1) transcript += event.results[i][0].transcript;
        transcriptRef.current = transcript;
        callbacks.current.onText(transcript);
        if (silenceRef.current) clearTimeout(silenceRef.current);
        silenceRef.current = setTimeout(() => recognition.stop(), SILENCE_MS);
      };
      recognition.onerror = (event) => {
        if (event.error === "not-allowed") callbacks.current.onDenied();
        else console.warn("Speech recognition error:", event.error);
        cancel();
      };
      recognition.onend = () => {
        recognitionRef.current = null;
        setState((current) => {
          if (current !== "listening") return current;
          if (!transcriptRef.current.trim()) return "idle";
          setCountdown(PREVIEW_SECONDS);
          return "preview";
        });
      };
      recognition.start();
      recognitionRef.current = recognition;
    } catch (error) {
      console.error("Failed to start speech recognition", error);
    }
  }, [cancel, lang]);

  useEffect(() => {
    if (state !== "preview") return;
    const timer = setTimeout(() => {
      if (countdown > 1) {
        setCountdown(countdown - 1);
        return;
      }
      setState("idle");
      setCountdown(0);
      callbacks.current.onSubmit(transcriptRef.current);
    }, 1000);
    return () => clearTimeout(timer);
  }, [countdown, state]);

  useEffect(() => () => {
    recognitionRef.current?.stop();
    if (silenceRef.current) clearTimeout(silenceRef.current);
  }, []);

  /** The traveler typed over the dictated text: keep it, but do not submit on their behalf. */
  const textEdited = useCallback(() => {
    if (state === "preview") cancel();
  }, [cancel, state]);

  return { state, countdown, supported, start, cancel, textEdited };
}
