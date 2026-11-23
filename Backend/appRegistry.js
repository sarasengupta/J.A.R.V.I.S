// J.A.R.V.I.S. App Registry
// Maps spoken app names -> local launch targets (exe paths, PATH commands,
// URI protocols, Start Menu AppIDs, websites) and launches them via child_process.
//
// Resolution order for a spoken name:
//   1. Website / domain ("youtube.com")
//   2. User overrides in apps.json
//   3. Curated registry below (first *available* launch candidate wins)
//   4. Auto-discovered Start Menu apps (Get-StartApps, incl. Store/UWP apps)

const { exec, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const HOME = os.homedir();
const LOCALAPPDATA = process.env.LOCALAPPDATA || path.join(HOME, 'AppData', 'Local');
const APPDATA = process.env.APPDATA || path.join(HOME, 'AppData', 'Roaming');
const PROGRAMFILES = process.env.ProgramFiles || 'C:\\Program Files';
const PROGRAMFILES_X86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
const SYSTEM32 = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32');
const USER_APPS_FILE = path.join(__dirname, 'apps.json');

// ---------------------------------------------------------------------------
// Curated registry. Each entry lists launch candidates, tried in order.
//   exe     : absolute path to an executable or shortcut
//   cmd     : command available on PATH (checked with `where`)
//   apppath : exe registered under Windows "App Paths" (Office apps etc.)
//   uri     : registered protocol handler (spotify:, ms-settings:)
//   url     : website, always opened in Google Chrome
// ---------------------------------------------------------------------------
const CURATED_APPS = [
  {
    name: 'Google Chrome',
    aliases: ['chrome', 'google chrome', 'browser', 'web browser', 'internet'],
    launch: [
      { type: 'exe', path: path.join(PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe') },
      { type: 'exe', path: path.join(PROGRAMFILES_X86, 'Google', 'Chrome', 'Application', 'chrome.exe') },
      { type: 'exe', path: path.join(LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe') }
    ]
  },
  {
    name: 'Visual Studio Code',
    aliases: ['vs code', 'vscode', 'code', 'visual studio code', 'code editor'],
    launch: [
      { type: 'exe', path: path.join(LOCALAPPDATA, 'Programs', 'Microsoft VS Code', 'Code.exe') },
      { type: 'exe', path: path.join(PROGRAMFILES, 'Microsoft VS Code', 'Code.exe') },
      { type: 'cmd', cmd: 'code' }
    ]
  },
  { name: 'Notepad', aliases: ['notepad', 'notes', 'text editor'], launch: [{ type: 'cmd', cmd: 'notepad' }] },
  { name: 'Calculator', aliases: ['calculator', 'calc'], launch: [{ type: 'uri', uri: 'calculator:' }, { type: 'cmd', cmd: 'calc' }] },
  {
    name: 'File Explorer',
    aliases: ['file explorer', 'explorer', 'files', 'my files', 'this pc', 'my computer'],
    launch: [{ type: 'exe', path: path.join(process.env.SystemRoot || 'C:\\Windows', 'explorer.exe') }]
  },
  {
    name: 'Windows Terminal',
    aliases: ['terminal', 'windows terminal', 'powershell'],
    launch: [{ type: 'cmd', cmd: 'wt' }, { type: 'exe', path: path.join(SYSTEM32, 'WindowsPowerShell', 'v1.0', 'powershell.exe') }]
  },
  { name: 'Command Prompt', aliases: ['command prompt', 'cmd'], launch: [{ type: 'exe', path: path.join(SYSTEM32, 'cmd.exe') }] },
  { name: 'Task Manager', aliases: ['task manager', 'taskmgr'], launch: [{ type: 'exe', path: path.join(SYSTEM32, 'Taskmgr.exe') }] },
  { name: 'Settings', aliases: ['settings', 'windows settings', 'pc settings'], launch: [{ type: 'uri', uri: 'ms-settings:' }] },
  { name: 'Control Panel', aliases: ['control panel'], launch: [{ type: 'exe', path: path.join(SYSTEM32, 'control.exe') }] },
  { name: 'Paint', aliases: ['paint', 'ms paint'], launch: [{ type: 'apppath', exe: 'mspaint.exe' }, { type: 'cmd', cmd: 'mspaint' }] },
  {
    name: 'Spotify',
    aliases: ['spotify', 'music'],
    launch: [
      { type: 'exe', path: path.join(APPDATA, 'Spotify', 'Spotify.exe') },
      { type: 'uri', uri: 'spotify:' },
      { type: 'url', url: 'https://open.spotify.com' }
    ]
  },
  {
    name: 'Discord',
    aliases: ['discord'],
    launch: [
      { type: 'exe', path: path.join(LOCALAPPDATA, 'Discord', 'Update.exe'), args: '--processStart Discord.exe' },
      { type: 'uri', uri: 'discord:' },
      { type: 'url', url: 'https://discord.com/app' }
    ]
  },
  { name: 'WhatsApp', aliases: ['whatsapp', 'whats app'], launch: [{ type: 'uri', uri: 'whatsapp:' }, { type: 'url', url: 'https://web.whatsapp.com' }] },
  { name: 'Steam', aliases: ['steam'], launch: [{ type: 'uri', uri: 'steam:' }] },
  { name: 'Microsoft Word', aliases: ['word', 'microsoft word', 'ms word'], launch: [{ type: 'apppath', exe: 'winword.exe' }, { type: 'url', url: 'https://www.office.com/launch/word' }] },
  { name: 'Microsoft Excel', aliases: ['excel', 'microsoft excel', 'ms excel'], launch: [{ type: 'apppath', exe: 'excel.exe' }, { type: 'url', url: 'https://www.office.com/launch/excel' }] },
  { name: 'Microsoft PowerPoint', aliases: ['powerpoint', 'power point', 'microsoft powerpoint', 'ppt'], launch: [{ type: 'apppath', exe: 'powerpnt.exe' }, { type: 'url', url: 'https://www.office.com/launch/powerpoint' }] },
  { name: 'Outlook', aliases: ['outlook', 'microsoft outlook'], launch: [{ type: 'apppath', exe: 'outlook.exe' }, { type: 'url', url: 'https://outlook.live.com' }] },

  // Websites (opened in Google Chrome)
  { name: 'YouTube', aliases: ['youtube', 'you tube', 'yt'], launch: [{ type: 'url', url: 'https://www.youtube.com' }] },
  { name: 'YouTube Music', aliases: ['youtube music', 'yt music'], launch: [{ type: 'url', url: 'https://music.youtube.com' }] },
  { name: 'Gmail', aliases: ['gmail', 'mail', 'email', 'my email', 'inbox'], launch: [{ type: 'url', url: 'https://mail.google.com' }] },
  { name: 'Google', aliases: ['google', 'google search'], launch: [{ type: 'url', url: 'https://www.google.com' }] },
  { name: 'Google Docs', aliases: ['google docs', 'docs'], launch: [{ type: 'url', url: 'https://docs.google.com' }] },
  { name: 'Google Sheets', aliases: ['google sheets', 'sheets'], launch: [{ type: 'url', url: 'https://sheets.google.com' }] },
  { name: 'Google Drive', aliases: ['google drive', 'drive'], launch: [{ type: 'url', url: 'https://drive.google.com' }] },
  { name: 'Google Calendar', aliases: ['google calendar', 'calendar', 'my calendar'], launch: [{ type: 'url', url: 'https://calendar.google.com' }] },
  { name: 'Google Maps', aliases: ['google maps', 'maps'], launch: [{ type: 'url', url: 'https://maps.google.com' }] },
  { name: 'GitHub', aliases: ['github', 'git hub'], launch: [{ type: 'url', url: 'https://github.com' }] },
  { name: 'Netflix', aliases: ['netflix'], launch: [{ type: 'url', url: 'https://www.netflix.com' }] },
  { name: 'Instagram', aliases: ['instagram', 'insta'], launch: [{ type: 'url', url: 'https://www.instagram.com' }] },
  { name: 'ChatGPT', aliases: ['chatgpt', 'chat gpt'], launch: [{ type: 'url', url: 'https://chatgpt.com' }] },
  { name: 'Gemini', aliases: ['gemini', 'google gemini'], launch: [{ type: 'url', url: 'https://gemini.google.com' }] },
  { name: 'X', aliases: ['twitter', 'x'], launch: [{ type: 'url', url: 'https://x.com' }] },
  { name: 'Reddit', aliases: ['reddit'], launch: [{ type: 'url', url: 'https://www.reddit.com' }] },
  { name: 'LinkedIn', aliases: ['linkedin', 'linked in'], launch: [{ type: 'url', url: 'https://www.linkedin.com' }] },
  { name: 'Amazon', aliases: ['amazon'], launch: [{ type: 'url', url: 'https://www.amazon.in' }] }
];

// ---------------------------------------------------------------------------
// Availability checks (cached)
// ---------------------------------------------------------------------------
const availabilityCache = new Map();

function quietExec(command) {
  try {
    execSync(command, { stdio: 'ignore', timeout: 4000, windowsHide: true });
    return true;
  } catch (e) {
    return false;
  }
}

function isCandidateAvailable(c) {
  const key = JSON.stringify(c);
  if (availabilityCache.has(key)) return availabilityCache.get(key);

  let ok = false;
  switch (c.type) {
    case 'exe':
    case 'lnk':
      ok = !!c.path && fs.existsSync(c.path);
      break;
    case 'cmd':
      ok = quietExec(`where ${c.cmd}`);
      break;
    case 'apppath':
      ok = quietExec(`reg query "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${c.exe}"`)
        || quietExec(`reg query "HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${c.exe}"`);
      break;
    case 'uri': {
      const scheme = c.uri.replace(/:.*$/, '');
      ok = quietExec(`reg query "HKCR\\${scheme}" /v "URL Protocol"`) || quietExec(`reg query "HKCR\\${scheme}"`);
      break;
    }
    case 'url':
    case 'appid':
      ok = true;
      break;
    default:
      ok = false;
  }

  availabilityCache.set(key, ok);
  return ok;
}

function firstAvailable(entry) {
  return (entry.launch || []).find(isCandidateAvailable) || null;
}

// ---------------------------------------------------------------------------
// User overrides (apps.json): { "my game": "D:\\Games\\game.exe", "notion": "notion:" }
// ---------------------------------------------------------------------------
function candidateFromString(target) {
  const t = String(target).trim();
  if (/^https?:\/\//i.test(t)) return { type: 'url', url: t };
  if (/^[a-z][a-z0-9+.-]*:$/i.test(t) || /^[a-z][a-z0-9+.-]{2,}:\/\//i.test(t)) return { type: 'uri', uri: t };
  if (/[\\/]/.test(t)) return { type: t.toLowerCase().endsWith('.lnk') ? 'lnk' : 'exe', path: t };
  return { type: 'cmd', cmd: t };
}

function loadUserApps() {
  try {
    if (!fs.existsSync(USER_APPS_FILE)) return [];
    const raw = JSON.parse(fs.readFileSync(USER_APPS_FILE, 'utf-8'));
    return Object.entries(raw)
      .filter(([name]) => !name.startsWith('_'))
      .map(([name, target]) => ({ name, aliases: [name], launch: [candidateFromString(target)], source: 'user' }));
  } catch (err) {
    console.warn('[App Registry] Could not read apps.json:', err.message);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Start Menu discovery (Get-StartApps covers desktop + Microsoft Store apps)
// ---------------------------------------------------------------------------
let discoveredApps = [];
const JUNK_PATTERN = /\b(uninstall|readme|read me|help|documentation|release notes|license|website|support|manual)\b/i;

function discoverStartMenuApps() {
  return new Promise((resolve) => {
    const cmd = 'powershell.exe -NoProfile -Command "Get-StartApps | ConvertTo-Json -Compress"';
    exec(cmd, { windowsHide: true, maxBuffer: 10 * 1024 * 1024, timeout: 20000 }, (err, stdout) => {
      if (err || !stdout.trim()) {
        console.warn('[App Registry] Start Menu discovery failed:', err ? err.message : 'no output');
        return resolve(discoveredApps);
      }
      try {
        const parsed = JSON.parse(stdout);
        const list = Array.isArray(parsed) ? parsed : [parsed];
        discoveredApps = list
          .filter((a) => a && a.Name && a.AppID && !JUNK_PATTERN.test(a.Name))
          .map((a) => ({
            name: a.Name,
            aliases: [a.Name],
            launch: [{ type: 'appid', appId: a.AppID }],
            source: 'start-menu'
          }));
        console.log(`[App Registry] Discovered ${discoveredApps.length} Start Menu apps.`);
      } catch (parseErr) {
        console.warn('[App Registry] Could not parse Start Menu apps:', parseErr.message);
      }
      resolve(discoveredApps);
    });
  });
}

// ---------------------------------------------------------------------------
// Fuzzy matching
// ---------------------------------------------------------------------------
const STOP_WORDS = new Set(['the', 'my', 'app', 'application', 'program', 'please', 'me', 'up', 'now', 'a', 'an', 'for']);

function normalize(s) {
  return (s || '')
    .toLowerCase()
    .replace(/[^a-z0-9+#\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !STOP_WORDS.has(w))
    .join(' ')
    .trim();
}

function levenshtein(a, b) {
  if (a === b) return 0;
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}

function scoreName(q, name) {
  const c = normalize(name);
  if (!q || !c) return 0;
  if (q === c) return 100;
  const qc = q.replace(/\s/g, '');
  const cc = c.replace(/\s/g, '');
  if (qc === cc) return 95; // "vscode" vs "vs code"
  if (c.startsWith(q + ' ') || (q.length >= 4 && c.startsWith(q))) return 85; // "visual studio" -> "visual studio code"
  if (q.startsWith(c + ' ') && q.split(' ').length - c.split(' ').length <= 1) return 75; // "spotify music" -> "spotify"
  const qw = q.split(' ');
  const cw = c.split(' ');
  if (qw.length > 1 && qw.every((w) => cw.includes(w))) return 70;
  if (qc.length >= 4) {
    const maxDist = qc.length >= 8 ? 2 : 1;
    if (levenshtein(qc, cc) <= maxDist) return 65; // mis-heard: "spotfy", "discrod"
  }
  return 0;
}

const MATCH_THRESHOLD = 65;
const DOMAIN_RE = /^(https?:\/\/)?([a-z0-9-]+\.)+[a-z]{2,}(\/\S*)?$/i;

/**
 * Resolve a spoken app name to a launchable entry.
 * Returns { name, source, candidate, score } or null.
 */
function resolveApp(query) {
  const raw = (query || '').trim();
  if (!raw) return null;

  const compactRaw = raw.replace(/\s+dot\s+/gi, '.').replace(/\s+/g, '');
  if (DOMAIN_RE.test(compactRaw)) {
    const url = /^https?:\/\//i.test(compactRaw) ? compactRaw : `https://${compactRaw}`;
    return { name: compactRaw.replace(/^https?:\/\//i, ''), source: 'url', candidate: { type: 'url', url }, score: 100 };
  }

  const q = normalize(raw);
  if (!q) return null;

  const pools = [
    { entries: loadUserApps(), bonus: 3 },
    { entries: CURATED_APPS.map((e) => ({ ...e, source: 'curated' })), bonus: 2 },
    { entries: discoveredApps, bonus: 0 }
  ];

  let best = null;
  for (const { entries, bonus } of pools) {
    for (const entry of entries) {
      const names = [entry.name, ...(entry.aliases || [])];
      const score = Math.max(...names.map((n) => scoreName(q, n)));
      if (score < MATCH_THRESHOLD) continue;
      const total = score + bonus;
      if (best && total <= best.total) continue;
      const candidate = firstAvailable(entry);
      if (!candidate) continue; // not installed on this PC
      best = { name: entry.name, source: entry.source, candidate, score, total };
    }
  }

  if (!best) return null;
  delete best.total;
  return best;
}

// ---------------------------------------------------------------------------
// Launching
// ---------------------------------------------------------------------------
function chromePath() {
  const chrome = CURATED_APPS[0].launch.find((c) => fs.existsSync(c.path));
  return chrome ? chrome.path : null;
}

const q = (s) => `"${String(s).replace(/"/g, '')}"`;

function buildLaunchCommand(c) {
  switch (c.type) {
    case 'exe':
    case 'lnk':
      return `start "" ${q(c.path)}${c.args ? ' ' + c.args : ''}`;
    case 'cmd':
      return `start "" ${c.cmd}${c.args ? ' ' + c.args : ''}`;
    case 'apppath':
      return `start "" ${c.exe}`;
    case 'uri':
      return `start "" ${q(c.uri)}`;
    case 'appid':
      return `start "" ${q('shell:AppsFolder\\' + c.appId)}`;
    case 'url': {
      const chrome = chromePath();
      return chrome ? `start "" ${q(chrome)} --new-window ${q(c.url)}` : `start "" ${q(c.url)}`;
    }
    default:
      return null;
  }
}

function runCandidate(candidate) {
  return new Promise((resolve) => {
    const command = buildLaunchCommand(candidate);
    if (!command) return resolve({ ok: false, error: `Unsupported launch type: ${candidate.type}` });
    // exec() runs through cmd.exe on Windows, so `start` hands the app to the shell
    // and it opens as a normal, visible window on the desktop.
    exec(command, { windowsHide: true, timeout: 15000 }, (err) => {
      resolve(err ? { ok: false, error: err.message, command } : { ok: true, command });
    });
  });
}

/**
 * Resolve and launch an app by spoken name.
 */
async function launchApp(query) {
  const match = resolveApp(query);
  if (!match) {
    return {
      success: false,
      action: 'open_app',
      target: query,
      message: `I couldn't find an application called "${query}" on this PC, Ma'am.`
    };
  }

  const run = await runCandidate(match.candidate);
  return {
    success: run.ok,
    action: 'open_app',
    target: query,
    app: match.name,
    source: match.source,
    launchType: match.candidate.type,
    message: run.ok
      ? `Opening ${match.name}, Ma'am.`
      : `I found ${match.name}, but it failed to launch: ${run.error}`
  };
}

/**
 * Open a URL in Google Chrome.
 */
async function launchUrl(url) {
  const safeUrl = url ? (/^https?:\/\//i.test(url) ? url : `https://${url}`) : 'https://www.google.com';
  const run = await runCandidate({ type: 'url', url: safeUrl });
  return {
    success: run.ok,
    action: 'open_browser',
    browser: 'Google Chrome',
    url: safeUrl,
    message: run.ok ? `Opening that in Chrome, Ma'am.` : `Failed to open Chrome: ${run.error}`
  };
}

function listApps() {
  const describe = (entries) => entries
    .map((e) => {
      const c = firstAvailable(e);
      return c ? { name: e.name, aliases: e.aliases, launchType: c.type } : null;
    })
    .filter(Boolean);
  return {
    user: describe(loadUserApps()),
    curated: describe(CURATED_APPS),
    discovered: discoveredApps.map((e) => e.name).sort()
  };
}

// Kick off discovery in the background as soon as the backend starts.
discoverStartMenuApps();

module.exports = {
  resolveApp,
  launchApp,
  launchUrl,
  listApps,
  refreshApps: discoverStartMenuApps,
  normalize
};
