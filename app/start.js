// J.A.R.V.I.S. Pure Node.js Desktop App Launcher
// Uses only signed node.exe + Google Chrome (no VBS, no hidden PowerShell bypass).

const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const BASE_URL = 'http://localhost:3001';
const HEALTH_URL = 'http://127.0.0.1:3001/health';

function checkHealth() {
  return new Promise((resolve) => {
    const req = http.get(HEALTH_URL, { timeout: 1000 }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

function findChrome() {
  const candidates = [
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe')
  ];
  return candidates.find((p) => p && fs.existsSync(p)) || null;
}

function openAppWindow() {
  const chrome = findChrome();
  const appUrl = `${BASE_URL}/?desktop=1`;
  if (chrome) {
    const child = spawn(
      chrome,
      [
        `--app=${appUrl}`,
        '--window-size=1440,900',
        '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding',
        '--disable-backgrounding-occluded-windows'
      ],
      { detached: true, stdio: 'ignore', windowsHide: false }
    );
    child.unref();
  } else {
    const child = spawn('cmd.exe', ['/c', 'start', '', appUrl], {
      detached: true,
      stdio: 'ignore',
      windowsHide: false
    });
    child.unref();
  }
}

(async () => {
  // If J.A.R.V.I.S. core is already online, just open the window and exit
  if (await checkHealth()) {
    openAppWindow();
    process.exit(0);
  }

  // Start J.A.R.V.I.S. backend as a detached hidden Node.js process so this
  // launcher console closes itself automatically in <1 second (zero VBS/PowerShell).
  const backendDir = path.join(__dirname, '..', 'Backend');
  const serverScript = path.join(backendDir, 'server.js');
  const core = spawn(process.execPath, [serverScript], {
    cwd: backendDir,
    detached: true,
    stdio: 'ignore',
    windowsHide: true
  });
  core.unref();

  // Wait up to 10s for Express to bind, then open the J.A.R.V.I.S. window and close launcher
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 250));
    if (await checkHealth()) {
      openAppWindow();
      process.exit(0);
    }
  }
  process.exit(0);
})();
