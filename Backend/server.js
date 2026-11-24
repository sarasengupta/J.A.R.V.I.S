const express = require('express');
const cors = require('cors');
const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');
const actions = require('./actions');
const appRegistry = require('./appRegistry');
const intentParser = require('./intentParser');

const app = express();
const PORT = process.env.PORT || 3001;

const fs = require('fs');
const path = require('path');

// Load local Backend/.env if present (keeps API keys out of git)
const envFile = path.join(__dirname, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf-8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}

// Dedicated Fish Audio Voice Cloning Credentials for Sara
const FISH_AUDIO_API_KEY = process.env.FISH_AUDIO_API_KEY || '';
const FISH_JARVIS_MODEL_ID = process.env.FISH_JARVIS_MODEL_ID || 'd53e83181bdf4d219a17de7b9fc4984c';

// Restrict CORS strictly to local J.A.R.V.I.S. origins so external websites cannot trigger actions
const ALLOWED_ORIGINS = new Set([
  'http://localhost:3001',
  'http://127.0.0.1:3001',
  'http://localhost:3000',
  'http://127.0.0.1:3000'
]);
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || ALLOWED_ORIGINS.has(origin)) return cb(null, true);
    return cb(new Error('Blocked by J.A.R.V.I.S. local-only security policy'));
  }
}));
app.use(express.json());

// 1. Fish Audio Custom Jarvis Voice Synthesis
async function generateFishAudioTts(text) {
  const resp = await fetch('https://api.fish.audio/v1/tts', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${FISH_AUDIO_API_KEY}`,
      'Content-Type': 'application/json',
      'model': 's2.1-pro-free'
    },
    body: JSON.stringify({
      text: text,
      reference_id: FISH_JARVIS_MODEL_ID,
      format: 'mp3'
    })
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Fish Audio error HTTP ${resp.status}: ${err}`);
  }

  const arrayBuffer = await resp.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

// Health Check
app.get('/health', (req, res) => {
  res.json({
    status: 'online',
    service: 'J.A.R.V.I.S. Dedicated Voice & Action Core',
    activeModel: 'Fish Audio Custom Clone',
    modelId: FISH_JARVIS_MODEL_ID,
    owner: 'Sara',
    actionSuite: [
      'open_app',
      'write_file',
      'read_file',
      'list_files',
      'manage_tasks',
      'set_reminder',
      'system_control'
    ]
  });
});

// Primary TTS Synthesis Endpoint
app.all(['/api/tts'], async (req, res) => {
  const text = (req.body && req.body.text) || req.query.text;

  if (!text || typeof text !== 'string') {
    return res.status(400).json({ error: 'Text prompt is required.' });
  }

  const cleanText = text.trim().slice(0, 4000);

  // 1. Primary: Sara's Dedicated Cloned Jarvis Model (Fish Audio)
  try {
    console.log(`[Jarvis Core] Synthesizing speech with model ${FISH_JARVIS_MODEL_ID}...`);
    const mp3Buffer = await generateFishAudioTts(cleanText);

    res.set({
      'Content-Type': 'audio/mpeg',
      'Content-Length': mp3Buffer.length,
      'Cache-Control': 'no-cache',
      'X-Voice-Engine': 'Fish-Audio-Jarvis-Cloned'
    });
    return res.send(mp3Buffer);
  } catch (fishErr) {
    console.warn('[Jarvis Core] Fish Audio API issue, using fallback:', fishErr.message);
  }

  // 2. High-Fidelity Edge Neural Fallback in case of network timeout
  try {
    const tts = new MsEdgeTTS();
    await tts.setMetadata('en-US-ChristopherNeural', OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
    const { audioStream } = tts.toStream(cleanText);

    res.set({
      'Content-Type': 'audio/mpeg',
      'Transfer-Encoding': 'chunked',
      'Cache-Control': 'no-cache',
      'X-Voice-Engine': 'Edge-Neural-Fallback'
    });

    audioStream.pipe(res);
  } catch (err) {
    console.error('[Jarvis Core] Synthesis failure:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to synthesize audio.' });
    }
  }
});

// Windows Operating System Action Execution API
app.post('/api/action/execute', async (req, res) => {
  const { action, params = {} } = req.body;
  console.log(`[J.A.R.V.I.S. Action] Received action: ${action}`, params);

  try {
    let result = null;
    switch (action) {
      case 'open_app':
        result = await actions.openApp(params.app || params.appName || params.target);
        break;
      case 'close_app':
        result = await actions.closeApp(params.app || params.appName || params.target);
        break;
      case 'write_file':
        result = await actions.writeDesktopFile(params.filename, params.content, params.folder);
        break;
      case 'read_file':
        result = await actions.readDesktopFile(params.filename, params.folder);
        break;
      case 'list_files':
        result = await actions.listUserFiles(params.folder);
        break;
      case 'manage_tasks':
        result = actions.manageTasks(
          params.op || params.operation,
          params.text || params.taskText || params.task_text,
          params.taskId || params.id
        );
        break;
      case 'set_reminder':
        result = actions.setReminder(
          params.text || params.reminderText || params.reminder_text,
          params.minutes,
          (alert) => {
            console.log('[Reminder Triggered]', alert);
          }
        );
        break;
      case 'system_control':
        result = await actions.systemControl(params.cmd || params.command);
        break;
      case 'run_command':
      case 'shell_cmd':
        result = await actions.executeShellCommand(params.cmd || params.command);
        break;
      case 'media_control':
        result = await actions.mediaControl(params.cmd || params.action || params.command);
        break;
      case 'keyboard_control':
        result = await actions.keyboardControl(params.text, params.key || params.keyCombo);
        break;
      case 'search_files':
        result = await actions.searchFiles(params.query || params.filename, params.folder);
        break;
      default:
        result = { success: false, message: `Unrecognized action: ${action}` };
    }

    return res.json(result);
  } catch (err) {
    console.error('[Action Error]', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Local intent parser: handles "open X" / "search X" instantly without the LLM.
// Responds { handled: false } when the phrase should go to the LLM instead.
app.post('/api/intent', async (req, res) => {
  const text = (req.body && req.body.text) || '';
  try {
    const outcome = await intentParser.handleIntent(text);
    if (outcome.handled) {
      console.log(`[J.A.R.V.I.S. Intent] "${text}" ->`, outcome.intent, '|', outcome.message);
    }
    return res.json(outcome);
  } catch (err) {
    console.error('[Intent Error]', err);
    return res.status(500).json({ handled: false, error: err.message });
  }
});

// App registry: list launchable apps, test a name, or re-scan the Start Menu
app.get('/api/apps', (req, res) => res.json(appRegistry.listApps()));
app.get('/api/apps/resolve', (req, res) => res.json({ query: req.query.name, match: appRegistry.resolveApp(req.query.name) }));
app.post('/api/apps/refresh', async (req, res) => {
  const apps = await appRegistry.refreshApps();
  res.json({ discovered: apps.length });
});

// Quick tasks fetch
app.get('/api/tasks', (req, res) => {
  const result = actions.manageTasks('list');
  res.json(result);
});

// Desktop app lifecycle: stays alive while window is open/minimized,
// and shuts down cleanly 4s after Sara closes the window (cancels if refreshed).
let shutdownTimer = null;

app.post('/api/ping', (req, res) => {
  if (shutdownTimer) {
    clearTimeout(shutdownTimer);
    shutdownTimer = null;
  }
  res.json({ ok: true });
});

app.post('/api/shutdown', (req, res) => {
  if (!shutdownTimer) {
    shutdownTimer = setTimeout(() => {
      process.exit(0);
    }, 4000);
  }
  res.json({ shuttingDown: true });
});

// Serve the built J.A.R.V.I.S. interface (frontend/build) so the whole app runs
// from this one server at http://localhost:3001 - used by the desktop launcher.
const FRONTEND_BUILD = path.join(__dirname, '..', 'frontend', 'build');
if (fs.existsSync(FRONTEND_BUILD)) {
  app.use(express.static(FRONTEND_BUILD));
  app.get(/^\/(?!api\/|health).*/, (req, res) => res.sendFile(path.join(FRONTEND_BUILD, 'index.html')));
}

// Bind strictly to 127.0.0.1 (localhost only) so nothing on the Wi-Fi/network can reach J.A.R.V.I.S.
app.listen(PORT, '127.0.0.1', () => {
  console.log(`[J.A.R.V.I.S. Core] Running on http://127.0.0.1:${PORT} (localhost-only)`);
  console.log(`[J.A.R.V.I.S. Core] Dedicated Model: ${FISH_JARVIS_MODEL_ID}`);
  console.log(`[J.A.R.V.I.S. Core] Windows OS Action Suite Engaged`);
});
