import { useEffect, useRef, useState } from "react";
import { Send, Mic, Square } from "lucide-react";

interface ChatInputProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  disabled?: boolean;
  placeholder?: string;
}

// The Web Speech API is prefixed on Chrome/Safari and absent on Firefox.
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((event: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
}

function getRecognition(): SpeechRecognitionLike | null {
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  return Ctor ? new Ctor() : null;
}

export default function ChatInput({ value, onChange, onSend, disabled, placeholder }: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const baseTextRef = useRef("");
  const [listening, setListening] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const [speechError, setSpeechError] = useState<string | null>(null);
  // Tracks IME composition so Enter during kanji conversion never sends.
  const composingRef = useRef(false);

  useEffect(() => {
    setSpeechSupported(getRecognition() !== null);
    return () => recognitionRef.current?.stop();
  }, []);

  // Grow with the text instead of scrolling a one-line box.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [value]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== "Enter") return;
    // Shift+Enter is always a newline.
    if (e.shiftKey) return;
    // While an IME is converting, Enter belongs to the IME: it confirms the
    // candidate. Sending here is what made Japanese input unusable. The
    // nativeEvent flag covers browsers that fire keydown with keyCode 229, and
    // the composition handlers cover the rest.
    if (composingRef.current || e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return;
    e.preventDefault();
    onSend();
  };

  const toggleListening = () => {
    setSpeechError(null);
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }

    const recognition = getRecognition();
    if (!recognition) {
      setSpeechError("このブラウザは音声入力に対応していません（Chrome・Edge・Safariでご利用ください）。");
      return;
    }

    recognition.lang = "ja-JP";
    recognition.continuous = true;
    recognition.interimResults = true;
    // Dictation appends to whatever was already typed rather than replacing it.
    baseTextRef.current = value ? `${value} ` : "";

    recognition.onresult = (event) => {
      let transcript = "";
      for (let i = 0; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }
      onChange(baseTextRef.current + transcript);
    };
    recognition.onerror = (event) => {
      setSpeechError(
        event.error === "not-allowed"
          ? "マイクの使用が許可されていません。ブラウザの設定で許可してください。"
          : `音声入力でエラーが発生しました（${event.error}）。`,
      );
      setListening(false);
    };
    recognition.onend = () => setListening(false);

    recognitionRef.current = recognition;
    recognition.start();
    setListening(true);
  };

  return (
    <div className="p-3 border-t border-slate-100">
      {listening && (
        <div className="flex items-center gap-2 text-[11px] text-rose-600 mb-2">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-500" />
          </span>
          音声を認識しています…　話し終えたら停止ボタンを押してください
        </div>
      )}
      {speechError && <div className="text-[11px] text-red-600 mb-2">{speechError}</div>}
      <div className="flex gap-2 items-end">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onCompositionStart={() => (composingRef.current = true)}
          onCompositionEnd={() => (composingRef.current = false)}
          onKeyDown={handleKeyDown}
          rows={1}
          placeholder={placeholder ?? "調査したい内容を入力してください"}
          className="flex-1 resize-none border border-slate-300 rounded-lg px-3 py-2 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-[var(--gda-green)] max-h-40"
        />
        {speechSupported && (
          <button
            onClick={toggleListening}
            title={listening ? "音声入力を停止" : "音声で入力"}
            className={`rounded-lg px-3 py-2 flex items-center justify-center shrink-0 ${
              listening ? "bg-rose-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            {listening ? <Square size={16} /> : <Mic size={16} />}
          </button>
        )}
        <button
          onClick={onSend}
          disabled={disabled || !value.trim()}
          className="bg-[var(--gda-navy)] disabled:opacity-40 text-white rounded-lg px-3 py-2 flex items-center justify-center shrink-0"
        >
          <Send size={16} />
        </button>
      </div>
      <div className="text-[10px] text-slate-400 mt-1.5">
        Enterで送信 ／ Shift+Enterで改行（日本語変換中のEnterでは送信されません）
      </div>
    </div>
  );
}
