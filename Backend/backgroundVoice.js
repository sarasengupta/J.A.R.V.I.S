// J.A.R.V.I.S. Native Windows Background Voice Engine
// Runs Microsoft's built-in System.Speech when the J.A.R.V.I.S. window is minimized/hidden
// so Sara's voice commands execute reliably even when Chrome suspends background tabs.

const { spawn, exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const intentParser = require('./intentParser');
const actions = require('./actions');

let listenerProc = null;
let lastCmd = '';
let lastCmdAt = 0;

function speakNativeFeedback(text) {
  if (!text) return;
  const safe = text.replace(/['"`]/g, '');
  const ps = `Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.Rate = 0; $s.Speak('${safe}')`;
  exec(`powershell.exe -NoProfile -Command "${ps}"`, { windowsHide: true }, () => {});
}

async function handleBackgroundPhrase(rawPhrase) {
  const clean = (rawPhrase || '')
    .replace(/^(?:hey|okay)\s+jarvis\s+/i, '')
    .replace(/^jarvis\s+/i, '')
    .trim();

  if (!clean) return;

  // Deduplicate rapid repeats within 2.5s
  const now = Date.now();
  if (clean.toLowerCase() === lastCmd && now - lastCmdAt < 2500) return;
  lastCmd = clean.toLowerCase();
  lastCmdAt = now;

  console.log(`[J.A.R.V.I.S. BG Voice] Heard: "${clean}"`);

  // 1. Check media / system shortcuts
  const lower = clean.toLowerCase();
  if (/^(volume up|volume down|mute|play|pause|next track|previous track)$/.test(lower)) {
    const res = await actions.mediaControl(lower);
    if (res && res.message) speakNativeFeedback(res.message);
    return;
  }
  if (lower === 'take a screenshot') {
    const res = await actions.systemControl('screenshot');
    if (res && res.message) speakNativeFeedback(res.message);
    return;
  }
  if (lower === 'lock computer') {
    const res = await actions.systemControl('lock');
    if (res && res.message) speakNativeFeedback(res.message);
    return;
  }

  // 2. Run through universal local intent parser (open, close, minimize, maximize, time, alarms, calendar)
  const outcome = await intentParser.handleIntent(clean);
  if (outcome && outcome.handled) {
    console.log(`[J.A.R.V.I.S. BG Voice] Executed: ${outcome.message}`);
    speakNativeFeedback(outcome.message);
  }
}

function startBackgroundListener() {
  if (listenerProc) return { running: true };

  const scriptPath = path.join(__dirname, 'bg_listener.ps1');
  if (!fs.existsSync(scriptPath)) {
    return { running: false, error: 'bg_listener.ps1 missing' };
  }

  try {
    listenerProc = spawn('powershell.exe', ['-NoProfile', '-File', scriptPath], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let buffer = '';
    listenerProc.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed === 'BG_VOICE_READY') {
          console.log('[J.A.R.V.I.S. BG Voice] Native Windows background listener ACTIVE.');
        } else if (trimmed.startsWith('CMD:')) {
          const phrase = trimmed.slice(4).trim();
          handleBackgroundPhrase(phrase).catch((err) => {
            console.warn('[BG Voice Execution Error]', err.message);
          });
        }
      }
    });

    listenerProc.stderr.on('data', (d) => {
      const msg = d.toString().trim();
      if (msg) console.warn('[BG Voice stderr]', msg.slice(0, 200));
    });

    listenerProc.on('close', () => {
      listenerProc = null;
    });

    return { running: true };
  } catch (err) {
    listenerProc = null;
    return { running: false, error: err.message };
  }
}

function stopBackgroundListener() {
  if (listenerProc) {
    try { listenerProc.kill(); } catch (e) {}
    listenerProc = null;
    console.log('[J.A.R.V.I.S. BG Voice] Paused (HUD window active).');
  }
  return { running: false };
}

function isRunning() {
  return !!listenerProc;
}

process.on('exit', () => {
  if (listenerProc) {
    try { listenerProc.kill(); } catch (e) {}
  }
});

module.exports = {
  startBackgroundListener,
  stopBackgroundListener,
  isRunning
};
