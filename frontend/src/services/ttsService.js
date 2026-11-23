// J.A.R.V.I.S. Dedicated Voice Synthesis Engine
// Dedicated Model: Fish Audio Custom Clone (d53e83181bdf4d219a17de7b9fc4984c)

const NEURAL_TTS_BACKEND = 'http://localhost:3001/api/tts';

let currentAudio = null;
let cachedVoices = [];

function loadVoices() {
  if (typeof window !== 'undefined' && window.speechSynthesis) {
    cachedVoices = window.speechSynthesis.getVoices();
  }
}

if (typeof window !== 'undefined' && window.speechSynthesis) {
  loadVoices();
  if (window.speechSynthesis.onvoiceschanged !== undefined) {
    window.speechSynthesis.onvoiceschanged = loadVoices;
  }
}

export const VOICE_PROFILES = [
  {
    id: 'fish_jarvis',
    neuralVoice: 'fish_jarvis',
    name: 'J.A.R.V.I.S. (Official Cloned Voice)',
    badge: 'ACTIVE VOICE CLONE',
    badgeColor: '#06b6d4',
    description: 'Custom-trained Fish Audio model (d53e83181bdf4d219a17de7b9fc4984c) — exclusive vocal persona for Sara.',
    previewText: 'Easy. I was just flirting with you. Standing by for your directive, Sara.'
  }
];

function cleanSpeechText(text) {
  if (!text) return '';
  return text
    .replace(/^◈\s*J\.A\.R\.V\.I\.S\s*\/\/\s*/i, '')
    .replace(/\[\[?ACTION:\s*[\s\S]*?\]\]?/gi, '')
    .replace(/\[COMMUNICATION ERROR:[^\]]*\]/gi, '')
    .replace(/\[.*?\]/g, '')
    .replace(/[`*#_~>]/g, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Fallback browser SpeechSynthesis in case backend is offline
 */
function fallbackToBrowserSynth(text, onStart, onEnd) {
  if (!window.speechSynthesis) {
    if (onEnd) onEnd();
    return;
  }

  stopJarvisSpeech();

  const clean = cleanSpeechText(text);

  if (!clean) {
    if (onEnd) onEnd();
    return;
  }

  const utterance = new SpeechSynthesisUtterance(clean);
  const voice =
    cachedVoices.find((v) => v.name.includes('Ryan') || v.name.includes('George') || v.name.includes('Male')) ||
    cachedVoices[0];

  if (voice) utterance.voice = voice;
  utterance.pitch = 0.92;
  utterance.rate = 0.98;

  utterance.onstart = () => { if (onStart) onStart(); };
  utterance.onend = () => { if (onEnd) onEnd(); };
  utterance.onerror = (e) => {
    console.warn('SpeechSynthesis event:', e);
    if (onEnd) onEnd();
  };

  window.speechSynthesis.speak(utterance);
}

/**
 * Universal Speak: Speaks with Sara's Custom Cloned Jarvis Voice
 */
export async function speakWithProfile(text, arg2, arg3, arg4) {
  let onStart = null;
  let onEnd = null;

  if (typeof arg2 === 'function') {
    onStart = arg2;
    onEnd = arg3;
  } else {
    onStart = arg3;
    onEnd = arg4;
  }

  const clean = cleanSpeechText(text);

  if (!clean) {
    if (onEnd) onEnd();
    return;
  }

  // Synthesize via Fish Audio Cloned Model on local backend
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000);

    const res = await fetch(NEURAL_TTS_BACKEND, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: clean,
        voice: 'fish_jarvis'
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (res.ok) {
      const blob = await res.blob();
      const audioUrl = URL.createObjectURL(blob);

      stopJarvisSpeech();

      const audio = new Audio(audioUrl);
      currentAudio = audio;

      audio.onplay = () => {
        if (onStart) onStart();
      };

      audio.onended = () => {
        URL.revokeObjectURL(audioUrl);
        currentAudio = null;
        if (onEnd) onEnd();
      };

      audio.onerror = (e) => {
        URL.revokeObjectURL(audioUrl);
        currentAudio = null;
        console.warn('[Jarvis Voice] Playback error, falling back:', e);
        fallbackToBrowserSynth(clean, onStart, onEnd);
      };

      const playPromise = audio.play();
      if (playPromise !== undefined) {
        playPromise.catch((err) => {
          console.warn('[Jarvis Voice] Autoplay blocked, falling back:', err);
          fallbackToBrowserSynth(clean, onStart, onEnd);
        });
      }
      return;
    }
  } catch (err) {
    console.warn('[Jarvis Voice] Backend unreachable, using fallback:', err.message);
  }

  // Fallback
  fallbackToBrowserSynth(clean, onStart, onEnd);
}

/**
 * Stop any ongoing speech or audio
 */
export function stopJarvisSpeech() {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.currentTime = 0;
    currentAudio = null;
  }
  if (typeof window !== 'undefined' && window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
}
