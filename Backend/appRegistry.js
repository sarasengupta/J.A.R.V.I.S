// J.A.R.V.I.S. App Registry
// Maps spoken app names -> local launch targets (exe paths, PATH commands,
// URI protocols, Start Menu AppIDs, websites) and launches them via child_process.
//
// Resolution order for a spoken name:
//   1. Website / domain ("youtube.com")
//   2. User overrides in apps.json
//   3. Curated registry below (first *available* launch candidate wins)
//   4. Auto-discovered Start Menu apps (Get-StartApps, incl. Store/UWP apps)

const { exec, execSync, spawn } = require('child_process');
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
  { name: 'Amazon', aliases: ['amazon'], launch: [{ type: 'url', url: 'https://www.amazon.in' }] },
  { name: 'Google Slides', aliases: ['google slides', 'slides'], launch: [{ type: 'url', url: 'https://slides.google.com' }] },
  { name: 'Google Meet', aliases: ['google meet', 'meet'], launch: [{ type: 'url', url: 'https://meet.google.com' }] },
  { name: 'Notion', aliases: ['notion'], launch: [{ type: 'uri', uri: 'notion:' }, { type: 'url', url: 'https://www.notion.so' }] },
  { name: 'Canva', aliases: ['canva'], launch: [{ type: 'url', url: 'https://www.canva.com' }] },
  { name: 'Figma', aliases: ['figma'], launch: [{ type: 'url', url: 'https://www.figma.com' }] },
  { name: 'Wikipedia', aliases: ['wikipedia', 'wiki'], launch: [{ type: 'url', url: 'https://www.wikipedia.org' }] },
  { name: 'Pinterest', aliases: ['pinterest'], launch: [{ type: 'url', url: 'https://www.pinterest.com' }] },
  { name: 'Facebook', aliases: ['facebook', 'fb'], launch: [{ type: 'url', url: 'https://www.facebook.com' }] },
  { name: 'Telegram', aliases: ['telegram'], launch: [{ type: 'uri', uri: 'tg:' }, { type: 'url', url: 'https://web.telegram.org' }] },
  { name: 'Zoom', aliases: ['zoom'], launch: [{ type: 'uri', uri: 'zoommtg:' }, { type: 'url', url: 'https://zoom.us' }] },
  { name: 'Prime Video', aliases: ['prime video', 'amazon prime', 'prime'], launch: [{ type: 'url', url: 'https://www.primevideo.com' }] },
  { name: 'Hotstar', aliases: ['hotstar', 'disney plus', 'jiohotstar'], launch: [{ type: 'url', url: 'https://www.hotstar.com' }] },
  { name: 'Flipkart', aliases: ['flipkart'], launch: [{ type: 'url', url: 'https://www.flipkart.com' }] },
  { name: 'Twitch', aliases: ['twitch'], launch: [{ type: 'url', url: 'https://www.twitch.tv' }] },

  // Common Windows folders
  { name: 'Downloads', aliases: ['downloads', 'downloads folder', 'my downloads'], launch: [{ type: 'exe', path: path.join(HOME, 'Downloads') }] },
  { name: 'Documents', aliases: ['documents', 'documents folder', 'my documents'], launch: [{ type: 'exe', path: fs.existsSync(path.join(HOME, 'OneDrive', 'Documents')) ? path.join(HOME, 'OneDrive', 'Documents') : path.join(HOME, 'Documents') }] },
  { name: 'Desktop', aliases: ['desktop', 'desktop folder', 'my desktop'], launch: [{ type: 'exe', path: fs.existsSync(path.join(HOME, 'OneDrive', 'Desktop')) ? path.join(HOME, 'OneDrive', 'Desktop') : path.join(HOME, 'Desktop') }] },
  { name: 'Pictures', aliases: ['pictures', 'photos folder', 'my pictures'], launch: [{ type: 'exe', path: fs.existsSync(path.join(HOME, 'OneDrive', 'Pictures')) ? path.join(HOME, 'OneDrive', 'Pictures') : path.join(HOME, 'Pictures') }] },
  { name: 'Videos', aliases: ['videos', 'videos folder', 'my videos'], launch: [{ type: 'exe', path: path.join(HOME, 'Videos') }] },
  { name: 'Music Folder', aliases: ['music folder', 'my music'], launch: [{ type: 'exe', path: path.join(HOME, 'Music') }] },
  { name: 'Recycle Bin', aliases: ['recycle bin', 'trash'], launch: [{ type: 'cmd', cmd: 'shell:RecycleBinFolder' }] }
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
  if (qw.length === 1 && q.length >= 3 && cw.includes(q)) return 78; // "edge" -> "microsoft edge", "photos" -> "microsoft photos"
  if (qw.length > 1 && qw.every((w) => cw.includes(w))) return 75;
  if (qc.length >= 4) {
    const maxDist = qc.length >= 8 ? 2 : 1;
    if (levenshtein(qc, cc) <= maxDist) return 65; // mis-heard: "spotfy", "discrod"
  }
  return 0;
}

// Discover Desktop shortcuts (.lnk, .url) and folders so Sara can say "open <shortcut/folder>"
function loadDesktopEntries() {
  const entries = [];
  const dirs = [
    path.join(HOME, 'OneDrive', 'Desktop'),
    path.join(HOME, 'Desktop')
  ];
  const seen = new Set();
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    try {
      for (const item of fs.readdirSync(dir)) {
        const lower = item.toLowerCase();
        if (lower.startsWith('.') || lower.includes('j.a.r.v.i.s')) continue;
        const full = path.join(dir, item);
        const ext = path.extname(item).toLowerCase();
        const base = ext === '.lnk' || ext === '.url' ? path.basename(item, ext) : item;
        const key = base.toLowerCase();
        if (seen.has(key)) continue;
        const isLnk = ext === '.lnk' || ext === '.url';
        let isDir = false;
        try { isDir = fs.statSync(full).isDirectory(); } catch (e) {}
        if (isLnk || isDir) {
          seen.add(key);
          entries.push({
            name: base,
            aliases: [base],
            launch: [{ type: 'lnk', path: full }],
            source: 'desktop'
          });
        }
      }
    } catch (e) {}
  }
  return entries;
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
    { entries: loadUserApps(), bonus: 4 },
    { entries: CURATED_APPS.map((e) => ({ ...e, source: 'curated' })), bonus: 3 },
    { entries: loadDesktopEntries(), bonus: 2 },
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
      return chrome ? `start "" ${q(chrome)} ${q(c.url)}` : `start "" ${q(c.url)}`;
    }
    default:
      return null;
  }
}

function spawnVisible(exePath, args = []) {
  return new Promise((resolve) => {
    try {
      const child = spawn(exePath, args, {
        detached: true,
        stdio: 'ignore',
        windowsHide: false
      });
      child.on('error', (err) => resolve({ ok: false, error: err.message }));
      child.unref();
      // Give spawn a tick to surface immediate ENOENT errors
      setTimeout(() => resolve({ ok: true, command: `${exePath} ${args.join(' ')}`.trim() }), 150);
    } catch (err) {
      resolve({ ok: false, error: err.message });
    }
  });
}

/**
 * Bring the launched app or Chrome browser window to the front of Sara's screen
 * (restoring if minimized and bypassing Windows background focus lock).
 */
function bringWindowToFront(titleHint = '', isChrome = false) {
  const safeHint = (titleHint || '').replace(/['"`]/g, '');
  const ps = `
Start-Sleep -Milliseconds 500
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class WinFocus {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc p, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, IntPtr p);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
  public static bool FocusMatching(string hint, bool chromeOnly) {
    IntPtr target = IntPtr.Zero;
    EnumWindows((h, l) => {
      if (!IsWindowVisible(h)) return true;
      var sb = new StringBuilder(512);
      GetWindowText(h, sb, 512);
      string t = sb.ToString();
      if (string.IsNullOrEmpty(t)) return true;
      if (t.IndexOf("J.A.R.V.I.S", StringComparison.OrdinalIgnoreCase) >= 0 || t.Equals("React App", StringComparison.OrdinalIgnoreCase)) return true;
      if (chromeOnly) {
        if (t.IndexOf("Google Chrome", StringComparison.OrdinalIgnoreCase) >= 0) {
          target = h;
          return false;
        }
        return true;
      }
      if (!string.IsNullOrEmpty(hint) && t.IndexOf(hint, StringComparison.OrdinalIgnoreCase) >= 0) {
        target = h;
        return false;
      }
      return true;
    }, IntPtr.Zero);
    if (target == IntPtr.Zero) return false;
    // Clean Win32 thread-input attach (no fake Alt key press that activates menu bars)
    IntPtr fg = GetForegroundWindow();
    uint fgThread = fg != IntPtr.Zero ? GetWindowThreadProcessId(fg, IntPtr.Zero) : 0;
    uint curThread = GetCurrentThreadId();
    bool attached = fgThread != 0 && fgThread != curThread && AttachThreadInput(curThread, fgThread, true);
    if (IsIconic(target)) ShowWindow(target, 9); else ShowWindow(target, 5);
    BringWindowToTop(target);
    SetForegroundWindow(target);
    if (attached) AttachThreadInput(curThread, fgThread, false);
    return true;
  }
}
"@
for ($attempt = 0; $attempt -lt 6; $attempt++) {
  if ([WinFocus]::FocusMatching('${safeHint}', $${isChrome ? 'true' : 'false'})) { break }
  Start-Sleep -Milliseconds 350
}
`.trim();
  // Fire-and-forget so the HTTP response stays instant while the window pops to front
  runPsEncoded(ps).catch(() => {});
}

function runCandidate(candidate, displayName = '') {
  // Direct detached spawn for Chrome URLs (opens as a tab in Chrome & brings Chrome to front)
  if (candidate.type === 'url') {
    const chrome = chromePath();
    if (chrome) {
      return spawnVisible(chrome, [candidate.url]).then((res) => {
        if (res.ok) bringWindowToFront(displayName, true);
        return res;
      });
    }
  }
  if (candidate.type === 'exe' && candidate.path) {
    // If the target path is a folder (Downloads, Documents, etc.), open it in File Explorer
    try {
      if (fs.existsSync(candidate.path) && fs.statSync(candidate.path).isDirectory()) {
        return spawnVisible(path.join(process.env.SystemRoot || 'C:\\Windows', 'explorer.exe'), [candidate.path]).then((res) => {
          if (res.ok) bringWindowToFront(displayName, false);
          return res;
        });
      }
    } catch (e) {}
    const args = candidate.args ? candidate.args.split(/\s+/).filter(Boolean) : [];
    const isChromeExe = path.basename(candidate.path).toLowerCase() === 'chrome.exe';
    return spawnVisible(candidate.path, args).then((res) => {
      if (res.ok) bringWindowToFront(displayName, isChromeExe);
      return res;
    });
  }

  return new Promise((resolve) => {
    const command = buildLaunchCommand(candidate);
    if (!command) return resolve({ ok: false, error: `Unsupported launch type: ${candidate.type}` });
    // windowsHide: false ensures the launched GUI app does NOT inherit SW_HIDE
    exec(command, { windowsHide: false, timeout: 15000 }, (err) => {
      if (!err) bringWindowToFront(displayName, false);
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

  const run = await runCandidate(match.candidate, match.name);
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

// ---------------------------------------------------------------------------
// Closing running apps (gracefully, without touching system processes or JARVIS)
// ---------------------------------------------------------------------------
const PROTECTED_PROCESSES = new Set([
  'explorer', 'csrss', 'lsass', 'wininit', 'svchost', 'dwm', 'system', 'node', 'powershell'
]);

const PROCESS_MAP = {
  'notepad': ['Notepad'],
  'calculator': ['CalculatorApp', 'Calculator'],
  'spotify': ['Spotify'],
  'visual studio code': ['Code'],
  'discord': ['Discord'],
  'whatsapp': ['WhatsApp', 'WhatsApp.Root'],
  'steam': ['steam'],
  'microsoft word': ['WINWORD'],
  'microsoft excel': ['EXCEL'],
  'microsoft powerpoint': ['POWERPNT'],
  'outlook': ['OUTLOOK', 'olk'],
  'paint': ['mspaint'],
  'windows terminal': ['WindowsTerminal'],
  'command prompt': ['cmd'],
  'task manager': ['Taskmgr'],
  'settings': ['SystemSettings'],
  'control panel': ['control'],
  'camera': ['WindowsCamera'],
  'clock': ['Time'],
  'claude': ['claude'],
  'chatgpt': ['ChatGPT', 'Codex']
};

function runPsEncoded(script) {
  return new Promise((resolve) => {
    const tmpFile = path.join(os.tmpdir(), `jarvis_helper_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.ps1`);
    try {
      fs.writeFileSync(tmpFile, script, 'utf-8');
    } catch (err) {
      return resolve({ ok: false, stdout: '', error: err.message });
    }
    exec(`powershell.exe -NoProfile -File "${tmpFile}"`, { windowsHide: true, timeout: 10000 }, (err, stdout) => {
      try { fs.unlinkSync(tmpFile); } catch (e) {}
      resolve({ ok: !err, stdout: (stdout || '').trim(), error: err ? err.message : null });
    });
  });
}

/**
 * Close ANY running desktop app, Store/UWP app, browser window, active window,
 * or all open apps by spoken name (never closes J.A.R.V.I.S. or Windows system processes).
 */
async function closeApp(query) {
  const raw = (query || '').trim();
  if (!raw) {
    return { success: false, action: 'close_app', message: "Which app should I close, Ma'am?" };
  }

  const lowerRaw = raw.toLowerCase();

  // 1. "close this / current window / active window"
  if (/^(?:this|this window|current|current window|active|active window|that|that window|it)$/i.test(lowerRaw)) {
    const ps = `
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class ActiveCloser {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  public static string CloseActive() {
    IntPtr h = GetForegroundWindow();
    if (h == IntPtr.Zero) return "";
    var sb = new StringBuilder(512);
    GetWindowText(h, sb, 512);
    string t = sb.ToString();
    if (string.IsNullOrEmpty(t) || t.Equals("Program Manager", StringComparison.OrdinalIgnoreCase) || t.IndexOf("J.A.R.V.I.S", StringComparison.OrdinalIgnoreCase) >= 0 || t.Equals("React App", StringComparison.OrdinalIgnoreCase)) return "";
    PostMessage(h, 0x0010, IntPtr.Zero, IntPtr.Zero);
    return t;
  }
}
"@
[ActiveCloser]::CloseActive()
`.trim();
    const res = await runPsEncoded(ps);
    if (res.stdout) {
      return { success: true, action: 'close_app', app: res.stdout, message: `Closed that window, Ma'am.` };
    }
    return { success: false, action: 'close_app', message: "There's no active app window to close right now, Ma'am." };
  }

  // 2. "close everything / all apps / all windows"
  if (/^(?:everything|all|all apps|all windows|every app|every window)$/i.test(lowerRaw)) {
    const ps = `
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class AllCloser {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc p, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  public static int CloseAll() {
    int count = 0;
    EnumWindows((h, l) => {
      if (!IsWindowVisible(h)) return true;
      var sb = new StringBuilder(512);
      GetWindowText(h, sb, 512);
      string t = sb.ToString();
      if (string.IsNullOrEmpty(t)) return true;
      if (t.Equals("Program Manager", StringComparison.OrdinalIgnoreCase) ||
          t.Equals("Windows Input Experience", StringComparison.OrdinalIgnoreCase) ||
          t.IndexOf("J.A.R.V.I.S", StringComparison.OrdinalIgnoreCase) >= 0 ||
          t.Equals("React App", StringComparison.OrdinalIgnoreCase)) return true;
      PostMessage(h, 0x0010, IntPtr.Zero, IntPtr.Zero);
      count++;
      return true;
    }, IntPtr.Zero);
    return count;
  }
}
"@
[AllCloser]::CloseAll()
`.trim();
    const res = await runPsEncoded(ps);
    const closedCount = parseInt(res.stdout, 10) || 0;
    return {
      success: closedCount > 0,
      action: 'close_app',
      app: 'all apps',
      closedCount,
      message: closedCount > 0
        ? `Closed ${closedCount} open window${closedCount > 1 ? 's' : ''}, Ma'am.`
        : "There aren't any other open windows to close, Ma'am."
    };
  }

  // 2b. "close tab / this tab / current tab" OR closing a specific website tab (e.g. "close YouTube")
  const isGenericTab = /^(?:tab|this tab|current tab|active tab|the tab)$/i.test(lowerRaw);
  const match = isGenericTab ? null : resolveApp(raw);
  const displayName = match ? match.name : raw;
  const key = displayName.toLowerCase();
  const isSpecificWebTab = !!(match && match.candidate && match.candidate.type === 'url');

  if (isGenericTab || isSpecificWebTab) {
    const tabFilter = isGenericTab ? '' : displayName.replace(/['"`]/g, '');
    const tabPs = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class TabCloser {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc p, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, IntPtr p);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool f);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
  public static bool FocusBrowserTab(string filter) {
    IntPtr target = IntPtr.Zero;
    EnumWindows((h, l) => {
      if (!IsWindowVisible(h)) return true;
      var sb = new StringBuilder(512);
      GetWindowText(h, sb, 512);
      string t = sb.ToString();
      if (string.IsNullOrEmpty(t)) return true;
      if (t.IndexOf("J.A.R.V.I.S", StringComparison.OrdinalIgnoreCase) >= 0 ||
          t.Equals("React App", StringComparison.OrdinalIgnoreCase)) return true;
      bool isBrowser = t.IndexOf("Google Chrome", StringComparison.OrdinalIgnoreCase) >= 0 ||
                       t.IndexOf("Microsoft Edge", StringComparison.OrdinalIgnoreCase) >= 0;
      if (!isBrowser) return true;
      if (string.IsNullOrEmpty(filter) || t.IndexOf(filter, StringComparison.OrdinalIgnoreCase) >= 0) {
        target = h;
        return false;
      }
      return true;
    }, IntPtr.Zero);
    if (target == IntPtr.Zero) return false;
    IntPtr fg = GetForegroundWindow();
    uint fgThread = fg != IntPtr.Zero ? GetWindowThreadProcessId(fg, IntPtr.Zero) : 0;
    uint curThread = GetCurrentThreadId();
    bool attached = fgThread != 0 && fgThread != curThread && AttachThreadInput(curThread, fgThread, true);
    if (IsIconic(target)) ShowWindow(target, 9); else ShowWindow(target, 5);
    BringWindowToTop(target);
    SetForegroundWindow(target);
    if (attached) AttachThreadInput(curThread, fgThread, false);
    return true;
  }
}
"@
if ([TabCloser]::FocusBrowserTab('${tabFilter}')) {
  Start-Sleep -Milliseconds 120
  [System.Windows.Forms.SendKeys]::SendWait('^w')
  Write-Output 1
} else {
  Write-Output 0
}
`.trim();

    const tabRes = await runPsEncoded(tabPs);
    const closed = parseInt(tabRes.stdout, 10) || 0;
    if (closed > 0) {
      return {
        success: true,
        action: 'close_app',
        app: isGenericTab ? 'current tab' : displayName,
        closedCount: 1,
        message: isGenericTab ? "Closed that tab, Ma'am." : `Closed the ${displayName} tab, Ma'am.`
      };
    }
    return {
      success: false,
      action: 'close_app',
      app: isGenericTab ? 'tab' : displayName,
      message: isGenericTab
        ? "I didn't find an active browser tab to close, Ma'am."
        : `I didn't find an active ${displayName} tab to close, Ma'am.`
    };
  }

  // 3. Universal Win32 EnumWindows closer — handles Store/UWP apps (ApplicationFrameHost),
  //    Chrome whole-browser close, and standard desktop windows by title!
  const isChromeOnly = key === 'google chrome' || key === 'chrome';
  const titleTerms = new Set();
  if (!isChromeOnly) {
    titleTerms.add(displayName);
    titleTerms.add(raw);
    const normRaw = normalize(raw);
    if (normRaw && normRaw.length >= 3) titleTerms.add(normRaw);
  }
  const safeTerms = Array.from(titleTerms)
    .filter((t) => t && t.length >= 2)
    .map((t) => t.replace(/['"`]/g, ''));

  const winClosePs = `
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class WinCloser {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc p, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  public static int CloseMatching(string[] filters, bool chromeOnly) {
    int count = 0;
    EnumWindows((h, l) => {
      if (!IsWindowVisible(h)) return true;
      var sb = new StringBuilder(512);
      GetWindowText(h, sb, 512);
      string t = sb.ToString();
      if (string.IsNullOrEmpty(t)) return true;
      if (t.Equals("Program Manager", StringComparison.OrdinalIgnoreCase) ||
          t.IndexOf("J.A.R.V.I.S", StringComparison.OrdinalIgnoreCase) >= 0 ||
          t.Equals("React App", StringComparison.OrdinalIgnoreCase)) return true;
      if (chromeOnly) {
        if (t.IndexOf("Google Chrome", StringComparison.OrdinalIgnoreCase) >= 0) {
          PostMessage(h, 0x0010, IntPtr.Zero, IntPtr.Zero);
          count++;
        }
        return true;
      }
      foreach (var f in filters) {
        if (!string.IsNullOrEmpty(f) && t.IndexOf(f, StringComparison.OrdinalIgnoreCase) >= 0) {
          PostMessage(h, 0x0010, IntPtr.Zero, IntPtr.Zero);
          count++;
          break;
        }
      }
      return true;
    }, IntPtr.Zero);
    return count;
  }
}
"@
[WinCloser]::CloseMatching([string[]]@(${safeTerms.map((t) => `'${t}'`).join(',')}), $${isChromeOnly ? 'true' : 'false'})
`.trim();

  const winRes = await runPsEncoded(winClosePs);
  const winClosed = parseInt(winRes.stdout, 10) || 0;

  // For websites / Chrome, never kill chrome.exe processes directly (that would kill J.A.R.V.I.S.)
  const isWebOrChrome = (match && match.candidate && match.candidate.type === 'url') || isChromeOnly;
  if (winClosed > 0 || isWebOrChrome) {
    if (winClosed > 0) {
      return { success: true, action: 'close_app', app: displayName, closedCount: winClosed, message: `Closed ${displayName}, Ma'am.` };
    }
    return { success: false, action: 'close_app', app: displayName, message: `I didn't find an open ${displayName} window to close, Ma'am.` };
  }

  // 4. Process-name fallback (catches apps minimized to system tray like Spotify, Discord, Steam)
  const procNames = new Set(PROCESS_MAP[key] || []);
  if (match && match.candidate) {
    if (match.candidate.path) {
      procNames.add(path.basename(match.candidate.path, path.extname(match.candidate.path)));
    }
    if (match.candidate.cmd) {
      procNames.add(match.candidate.cmd.replace(/\.exe$/i, ''));
    }
    if (match.candidate.exe) {
      procNames.add(match.candidate.exe.replace(/\.exe$/i, ''));
    }
  }
  const cleanWord = normalize(raw).replace(/\s+/g, '');
  if (cleanWord) procNames.add(cleanWord);

  const safeNames = Array.from(procNames)
    .filter((n) => n && !PROTECTED_PROCESSES.has(n.toLowerCase()))
    .map((n) => `'${n.replace(/'/g, "''")}'`);

  const ps = `
$targets = @()
$names = @(${safeNames.join(',')})
foreach ($n in $names) {
  $p = Get-Process -Name $n -ErrorAction SilentlyContinue
  if ($p) { $targets += $p }
}
$targets = $targets | Sort-Object Id -Unique
if ($targets.Count -eq 0) { Write-Output 0; exit 0 }
foreach ($proc in $targets) { try { $null = $proc.CloseMainWindow() } catch {} }
Start-Sleep -Milliseconds 400
foreach ($proc in $targets) {
  try {
    if (-not $proc.HasExited) { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue }
  } catch {}
}
Write-Output $targets.Count
`.trim();

  const res = await runPsEncoded(ps);
  const closedCount = parseInt(res.stdout, 10) || 0;
  if (closedCount > 0) {
    return {
      success: true,
      action: 'close_app',
      app: displayName,
      closedCount,
      message: `Closed ${displayName}, Ma'am.`
    };
  }

  return {
    success: false,
    action: 'close_app',
    app: displayName,
    message: `${displayName} doesn't appear to be open right now, Ma'am.`
  };
}

// Kick off discovery in the background as soon as the backend starts.
discoverStartMenuApps();

module.exports = {
  resolveApp,
  launchApp,
  closeApp,
  launchUrl,
  listApps,
  refreshApps: discoverStartMenuApps,
  normalize
};
