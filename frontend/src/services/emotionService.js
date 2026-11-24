// J.A.R.V.I.S. Real-Time Voice & Text Emotion Recognition Engine
// Runs 100% locally on Sara's laptop using Web Audio API prosody analysis + lexical cues.

export const EMOTION_PROFILES = {
  happy: {
    emotion: 'happy',
    label: 'HAPPY',
    color: '#22c55e',
    toneHint: "Sara sounds happy and upbeat. Match her warm, bright mood with genuine J.A.R.V.I.S. charm."
  },
  excited: {
    emotion: 'excited',
    label: 'EXCITED',
    color: '#f59e0b',
    toneHint: "Sara sounds excited and energized. Share her enthusiasm while keeping your calm tactical polish."
  },
  sad: {
    emotion: 'sad',
    label: 'SAD',
    color: '#60a5fa',
    toneHint: "Sara sounds sad or down. Respond gently, warmly, and empathetically, offering comfort and support."
  },
  angry: {
    emotion: 'angry',
    label: 'ANGRY',
    color: '#ef4444',
    toneHint: "Sara sounds frustrated or angry. Stay extra calm, patient, validating, and immediately helpful—never lecture."
  },
  stressed: {
    emotion: 'stressed',
    label: 'STRESSED',
    color: '#a855f7',
    toneHint: "Sara sounds stressed or overwhelmed. Be grounding, reassuring, and offer to handle things for her."
  },
  calm: {
    emotion: 'calm',
    label: 'CALM',
    color: '#06b6d4',
    toneHint: "Sara sounds calm and neutral. Respond with classic calm, confident J.A.R.V.I.S. precision."
  }
};

const LEXICAL_PATTERNS = {
  angry: /\b(angry|mad|furious|pissed|annoyed|annoying|irritated|frustrated|frustrating|hate|stupid|ugh|wtf|shut up|leave me alone|sick of|fed up|ridiculous|worst|terrible)\b/i,
  sad: /\b(sad|upset|crying|cry|depressed|lonely|hurt|heartbroken|miss|miserable|down|hopeless|bad day|rough day|tired of everything|not okay|feeling low|disappointed|sorry)\b/i,
  stressed: /\b(stressed|anxious|anxiety|overwhelmed|panicking|panic|nervous|worried|exhausted|burnout|too much|can't handle|deadline|scared|freaking out)\b/i,
  excited: /\b(excited|omg|oh my god|awesome|amazing|yay|woohoo|can't wait|so pumped|incredible|let's go|best day|nailed it)\b/i,
  happy: /\b(happy|glad|great|good|love|loving|wonderful|fantastic|nice|yay|smiling|cheerful|grateful|thank you|thanks|appreciate|fun|proud)\b/i
};

/**
 * Monitors live microphone audio energy & spectral brightness (pitch proxy)
 * to capture vocal tone without recording or uploading any audio.
 */
export function createVoiceEmotionMonitor(mediaStream) {
  if (typeof window === 'undefined' || !mediaStream) {
    return {
      getRecentVocalStats: () => null,
      stop: () => {}
    };
  }

  let audioCtx = null;
  let intervalId = null;
  const samples = []; // Rolling ~2.5s of active speech frames

  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    audioCtx = new AudioCtx();
    const source = audioCtx.createMediaStreamSource(mediaStream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);

    const timeData = new Float32Array(analyser.fftSize);
    const freqData = new Uint8Array(analyser.frequencyBinCount);

    intervalId = setInterval(() => {
      if (!audioCtx || audioCtx.state === 'closed') return;
      if (audioCtx.state === 'suspended') {
        audioCtx.resume().catch(() => {});
      }

      analyser.getFloatTimeDomainData(timeData);
      analyser.getByteFrequencyData(freqData);

      // Compute RMS loudness
      let sumSq = 0;
      for (let i = 0; i < timeData.length; i++) {
        sumSq += timeData[i] * timeData[i];
      }
      const rms = Math.sqrt(sumSq / timeData.length);

      // Only record active voice frames above room noise floor
      if (rms > 0.015) {
        let weightedSum = 0;
        let magSum = 0;
        for (let i = 1; i < freqData.length; i++) {
          weightedSum += i * freqData[i];
          magSum += freqData[i];
        }
        const centroid = magSum > 0 ? weightedSum / magSum : 0; // higher = brighter / higher pitch

        samples.push({ t: Date.now(), rms, centroid });
        const cutoff = Date.now() - 3000;
        while (samples.length > 0 && samples[0].t < cutoff) {
          samples.shift();
        }
      }
    }, 100);
  } catch (err) {
    console.warn('[Emotion Monitor] Web Audio init skipped:', err.message);
  }

  return {
    getRecentVocalStats() {
      const cutoff = Date.now() - 3500;
      const recent = samples.filter((s) => s.t >= cutoff);
      if (recent.length < 3) return null;

      const avgRms = recent.reduce((a, s) => a + s.rms, 0) / recent.length;
      const peakRms = Math.max(...recent.map((s) => s.rms));
      const avgCentroid = recent.reduce((a, s) => a + s.centroid, 0) / recent.length;

      // Energy variance (expressive/animated speech vs flat/subdued speech)
      const variance = recent.reduce((a, s) => a + Math.pow(s.rms - avgRms, 2), 0) / recent.length;

      return {
        avgRms,
        peakRms,
        avgCentroid,
        variance,
        frameCount: recent.length
      };
    },
    stop() {
      if (intervalId) clearInterval(intervalId);
      if (audioCtx && audioCtx.state !== 'closed') {
        audioCtx.close().catch(() => {});
      }
    }
  };
}

/**
 * Combine transcript text cues + live vocal prosody to infer Sara's current emotion.
 */
export function detectUserEmotion(transcript = '', vocalStats = null) {
  const text = (transcript || '').trim();
  const scores = { angry: 0, sad: 0, stressed: 0, excited: 0, happy: 0, calm: 1 };

  // 1. Lexical / text emotion signals (strongest indicator)
  if (LEXICAL_PATTERNS.angry.test(text)) scores.angry += 4;
  if (LEXICAL_PATTERNS.sad.test(text)) scores.sad += 4;
  if (LEXICAL_PATTERNS.stressed.test(text)) scores.stressed += 4;
  if (LEXICAL_PATTERNS.excited.test(text)) scores.excited += 4;
  if (LEXICAL_PATTERNS.happy.test(text)) scores.happy += 3;

  // Exclamation / emphasis
  if (/!/.test(text)) {
    scores.excited += 1;
    if (scores.angry > 0) scores.angry += 1;
  }

  // 2. Vocal prosody signals (volume, pitch brightness, expressiveness)
  let vocalReason = '';
  if (vocalStats) {
    const { avgRms, peakRms, avgCentroid, variance } = vocalStats;

    if (peakRms > 0.22 && avgRms > 0.11) {
      // Very loud / intense voice
      if (scores.happy > 0 || scores.excited > 0 || avgCentroid > 42) {
        scores.excited += 2.5;
        vocalReason = 'high-energy animated voice';
      } else {
        scores.angry += 2.5;
        vocalReason = 'loud intense vocal tone';
      }
    } else if (avgRms < 0.04 && variance < 0.0005 && avgCentroid < 24) {
      // Very soft, low-energy, flat voice
      scores.sad += 1.8;
      vocalReason = 'soft low-energy vocal tone';
    } else if (avgCentroid > 36 && variance > 0.0015) {
      // Bright, lively pitch modulation
      scores.happy += 1.8;
      vocalReason = 'bright lively vocal tone';
    }
  }

  // Pick highest scoring emotion
  let best = 'calm';
  let bestScore = scores.calm;
  for (const key of ['angry', 'sad', 'stressed', 'excited', 'happy']) {
    if (scores[key] > bestScore) {
      bestScore = scores[key];
      best = key;
    }
  }

  const profile = EMOTION_PROFILES[best];
  return {
    ...profile,
    confidence: Math.min(1, Number((bestScore / 5).toFixed(2))),
    reason: vocalReason || (best === 'calm' ? 'steady tone' : 'word and tone cues')
  };
}
