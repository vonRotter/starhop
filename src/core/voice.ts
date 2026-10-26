import { getLang } from './i18n';

// Read-aloud with the browser's own voices (ported from Couch). Stays quiet when the device has no
// voice for the current language: an English voice reading Norwegian is worse than silence.
let enabled = false;
let voices: SpeechSynthesisVoice[] = [];

function loadVoices(): void {
  try {
    voices = window.speechSynthesis?.getVoices() ?? [];
  } catch {
    voices = [];
  }
}
if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
  loadVoices();
  try {
    window.speechSynthesis.addEventListener('voiceschanged', loadVoices);
  } catch {
    /* old browsers */
  }
}

export function setVoice(on: boolean): void {
  enabled = on;
  if (!enabled) stopVoice();
}

export function voiceOn(): boolean {
  return enabled;
}

/** Speak a line (replacing whatever is being said). Returns true if it spoke. */
export function say(text: string, { pitch = 1, rate = 0.95 } = {}): boolean {
  if (!enabled || !text) return false;
  if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') return false;
  try {
    if (!voices.length) loadVoices();
    const no = getLang() === 'no';
    const re = no ? /^(nb|no|nn)(-|$)/i : /^en(-|$)/i;
    const list = voices.filter((v) => re.test(String(v.lang).replace('_', '-')));
    const voice = list.find((v) => v.localService) ?? list[0] ?? null;
    if (!voice) return false;
    const u = new SpeechSynthesisUtterance(clean(text, no));
    u.lang = voice.lang;
    u.voice = voice;
    u.rate = rate;
    u.pitch = pitch;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
    return true;
  } catch {
    return false;
  }
}

export function stopVoice(): void {
  try {
    window.speechSynthesis?.cancel();
  } catch {
    /* nothing to stop */
  }
}

function clean(text: string, no: boolean): string {
  return String(text)
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s\/\s/g, no ? ' eller ' : ' or ')
    .replace(/[«»"“”◀▶▲▼★✓•]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
