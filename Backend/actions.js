// J.A.R.V.I.S. Operating System Action Suite
// Native Windows OS Automation for Sara's PC

const { exec, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Standard user paths
const USER_HOME = os.homedir();
const DESKTOP_PATH = fs.existsSync(path.join(USER_HOME, 'OneDrive', 'Desktop'))
  ? path.join(USER_HOME, 'OneDrive', 'Desktop')
  : path.join(USER_HOME, 'Desktop');

const DOCUMENTS_PATH = fs.existsSync(path.join(USER_HOME, 'OneDrive', 'Documents'))
  ? path.join(USER_HOME, 'OneDrive', 'Documents')
  : path.join(USER_HOME, 'Documents');

const TASKS_FILE = path.join(__dirname, 'tasks.json');

// App name -> local command/path mapping lives in appRegistry.js
const registry = require('./appRegistry');

// Ensure tasks storage exists
if (!fs.existsSync(TASKS_FILE)) {
  fs.writeFileSync(TASKS_FILE, JSON.stringify([], null, 2), 'utf-8');
}

/**
 * Open a URL in Google Chrome (delegates to appRegistry)
 */
function launchBrowser(url = '') {
  return registry.launchUrl(url);
}

/**
 * 1. Application & Website Launcher
 * Resolves the spoken name through appRegistry (curated map, apps.json overrides,
 * auto-discovered Start Menu apps) and launches it via child_process.
 */
async function openApp(appName) {
  const raw = (appName || '').trim();
  if (!raw) {
    return { success: false, action: 'open_app', message: "Which application should I open, Ma'am?" };
  }

  // "search <topic>" style requests from the LLM
  const search = raw.match(/^(?:search|google|find)\s+(?:for\s+)?(.+)$/i);
  if (search) {
    return registry.launchUrl(`https://www.google.com/search?q=${encodeURIComponent(search[1].trim())}`);
  }

  return registry.launchApp(raw);
}

/**
 * 1b. Close Running Application / Browser Window
 */
async function closeApp(appName) {
  return registry.closeApp(appName);
}

/**
 * 2. File & Document Writing (Desktop / Documents)
 */
function writeDesktopFile(filename, content, folder = 'desktop') {
  return new Promise((resolve) => {
    try {
      const targetDir = folder.toLowerCase() === 'documents' ? DOCUMENTS_PATH : DESKTOP_PATH;
      const safeFilename = path.basename(filename || 'jarvis_note.txt');
      const targetPath = path.join(targetDir, safeFilename);

      fs.writeFileSync(targetPath, content || '', 'utf-8');

      resolve({
        success: true,
        action: 'write_file',
        filename: safeFilename,
        filePath: targetPath,
        message: `File "${safeFilename}" written successfully to your ${folder}, Ma'am.`
      });
    } catch (err) {
      resolve({
        success: false,
        action: 'write_file',
        error: err.message,
        message: `Failed to create file: ${err.message}`
      });
    }
  });
}

/**
 * 3. File Reading
 */
function readDesktopFile(filename, folder = 'desktop') {
  return new Promise((resolve) => {
    try {
      const targetDir = folder.toLowerCase() === 'documents' ? DOCUMENTS_PATH : DESKTOP_PATH;
      const safeFilename = path.basename(filename);
      const targetPath = path.join(targetDir, safeFilename);

      if (!fs.existsSync(targetPath)) {
        return resolve({
          success: false,
          message: `File "${safeFilename}" was not found on your ${folder}, Ma'am.`
        });
      }

      const content = fs.readFileSync(targetPath, 'utf-8');
      resolve({
        success: true,
        filename: safeFilename,
        content: content.slice(0, 5000),
        message: `Read "${safeFilename}" successfully.`
      });
    } catch (err) {
      resolve({
        success: false,
        error: err.message,
        message: `Could not read file: ${err.message}`
      });
    }
  });
}

/**
 * 4. List Files on Desktop / Documents
 */
function listUserFiles(folder = 'desktop') {
  return new Promise((resolve) => {
    try {
      const targetDir = folder.toLowerCase() === 'documents' ? DOCUMENTS_PATH : DESKTOP_PATH;
      const files = fs.readdirSync(targetDir)
        .filter((f) => !f.startsWith('.'))
        .slice(0, 20);

      resolve({
        success: true,
        folder,
        files,
        message: `You have ${files.length} items visible on your ${folder}, Ma'am.`
      });
    } catch (err) {
      resolve({
        success: false,
        error: err.message,
        message: `Could not read directory: ${err.message}`
      });
    }
  });
}

/**
 * 5. Task & To-Do List Management
 */
function manageTasks(operation = 'list', text = '', taskId = null) {
  try {
    let tasks = [];
    if (fs.existsSync(TASKS_FILE)) {
      tasks = JSON.parse(fs.readFileSync(TASKS_FILE, 'utf-8') || '[]');
    }

    const op = (operation || 'list').toLowerCase();

    if (op === 'add') {
      const newTask = {
        id: Date.now(),
        text: (text || '').trim(),
        completed: false,
        createdAt: new Date().toISOString()
      };
      tasks.push(newTask);
      fs.writeFileSync(TASKS_FILE, JSON.stringify(tasks, null, 2), 'utf-8');
      return {
        success: true,
        action: 'add_task',
        task: newTask,
        totalTasks: tasks.length,
        message: `Added task "${newTask.text}" to your checklist, Ma'am.`
      };
    }

    if (op === 'complete') {
      const idToFind = Number(taskId);
      const task = tasks.find((t) => t.id === idToFind || t.text.toLowerCase().includes((text || '').toLowerCase()));
      if (task) {
        task.completed = true;
        fs.writeFileSync(TASKS_FILE, JSON.stringify(tasks, null, 2), 'utf-8');
        return {
          success: true,
          action: 'complete_task',
          task,
          message: `Marked "${task.text}" as completed, Ma'am.`
        };
      }
      return { success: false, message: 'Could not find that task to mark complete.' };
    }

    if (op === 'delete') {
      const idToFind = Number(taskId);
      const beforeCount = tasks.length;
      tasks = tasks.filter((t) => t.id !== idToFind && !t.text.toLowerCase().includes((text || '').toLowerCase()));
      fs.writeFileSync(TASKS_FILE, JSON.stringify(tasks, null, 2), 'utf-8');
      return {
        success: true,
        action: 'delete_task',
        removedCount: beforeCount - tasks.length,
        message: `Task removed from your list, Ma'am.`
      };
    }

    // Default: List tasks
    const pending = tasks.filter((t) => !t.completed);
    return {
      success: true,
      action: 'list_tasks',
      tasks,
      pendingCount: pending.length,
      message: pending.length === 0
        ? 'All tasks are completed, Sara. Your schedule is clear!'
        : `You have ${pending.length} pending tasks: ${pending.map((t) => t.text).join(', ')}.`
    };
  } catch (err) {
    return { success: false, error: err.message, message: 'Task management error.' };
  }
}

/**
 * 6. Reminder & Timer Scheduler
 */
const activeTimers = new Map();

function setReminder(reminderText, minutes = 1, onTriggerCallback) {
  const ms = Math.max(1, Number(minutes) || 1) * 60 * 1000;
  const timerId = Date.now();

  const timeoutHandle = setTimeout(() => {
    activeTimers.delete(timerId);

    // Trigger Windows Toast Notification via PowerShell
    const escapedText = (reminderText || 'Reminder alert').replace(/"/g, '`"');
    const psToast = `powershell -Command "[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null; $xml = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02); $text = $xml.GetElementsByTagName('text'); $text[0].AppendChild($xml.CreateTextNode('J.A.R.V.I.S. Reminder')) > $null; $text[1].AppendChild($xml.CreateTextNode('${escapedText}')) > $null; $toast = [Windows.UI.Notifications.ToastNotification]::new($xml); [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('J.A.R.V.I.S.').Show($toast);"`;

    exec(psToast, () => {});

    if (onTriggerCallback) {
      onTriggerCallback({
        timerId,
        text: reminderText,
        message: `Pardon the interruption, Sara. Reminder: ${reminderText}, Ma'am.`
      });
    }
  }, ms);

  activeTimers.set(timerId, { handle: timeoutHandle, text: reminderText, minutes });

  return {
    success: true,
    action: 'set_reminder',
    timerId,
    minutes,
    message: `Reminder set for ${minutes} minute${minutes > 1 ? 's' : ''} from now: "${reminderText}", Ma'am.`
  };
}

/**
 * 7. System Controls (Lock, Screenshot, Telemetry)
 */
function systemControl(command) {
  return new Promise((resolve) => {
    const cmd = (command || '').toLowerCase();

    if (cmd === 'lock') {
      exec('rundll32.exe user32.dll,LockWorkStation', (err) => {
        resolve({
          success: !err,
          action: 'lock_workstation',
          message: err ? 'Failed to lock PC.' : "Workstation locked successfully, Ma'am."
        });
      });
      return;
    }

    if (cmd === 'screenshot') {
      const filename = `JARVIS_Screenshot_${Date.now()}.png`;
      const savePath = path.join(DESKTOP_PATH, filename);
      const psScript = `
        Add-Type -AssemblyName System.Windows.Forms
        Add-Type -AssemblyName System.Drawing
        $b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
        $bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
        $g = [System.Drawing.Graphics]::FromImage($bmp)
        $g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size)
        $bmp.Save('${savePath.replace(/\\/g, '\\\\')}')
        $g.Dispose()
        $bmp.Dispose()
      `.trim();

      const encoded = Buffer.from(psScript, 'utf16le').toString('base64');
      exec(`powershell -EncodedCommand ${encoded}`, (err) => {
        resolve({
          success: !err,
          action: 'screenshot',
          filePath: savePath,
          message: err ? 'Failed to capture screenshot.' : `Screenshot captured and saved to Desktop as "${filename}", Ma'am.`
        });
      });
      return;
    }

    if (cmd === 'status') {
      const freeMemGb = (os.freemem() / (1024 ** 3)).toFixed(2);
      const totalMemGb = (os.totalmem() / (1024 ** 3)).toFixed(2);
      const uptimeHours = (os.uptime() / 3600).toFixed(1);

      resolve({
        success: true,
        action: 'system_status',
        freeMemGb,
        totalMemGb,
        uptimeHours,
        platform: os.platform(),
        cpus: os.cpus().length,
        message: `System operational: ${freeMemGb}GB RAM free of ${totalMemGb}GB. Uptime: ${uptimeHours} hours. All cores nominal, Ma'am.`
      });
      return;
    }

    resolve({
      success: false,
      message: `Unknown system command: ${command}`
    });
  });
}

/**
 * 8. Universal PowerShell / CMD Shell Execution
 */
function executeShellCommand(cmd) {
  return new Promise((resolve) => {
    if (!cmd || !cmd.trim()) {
      return resolve({ success: false, message: 'Empty command.' });
    }

    // Safety guard: block destructive, privilege-escalation, or remote-download commands
    const BLOCKED_PATTERNS = [
      /\b(format|diskpart|bcdedit|cipher|takeown|icacls|reg\s+delete|net\s+user|net\s+localgroup)\b/i,
      /\b(rm\s+-rf|del\s+\/[sfq]|erase\s+\/[sfq]|rmdir\s+\/s|rd\s+\/s|remove-item\b.*-recurse|clear-disk|format-volume)\b/i,
      /\b(shutdown|stop-computer|restart-computer|taskkill\s+\/f\s+\/im\s+(csrss|lsass|wininit|svchost|explorer))\b/i,
      /\b(invoke-expression|iex\b|downloadstring|downloadfile|invoke-webrequest\b.*\|)/i
    ];

    if (BLOCKED_PATTERNS.some((re) => re.test(cmd))) {
      console.warn('[J.A.R.V.I.S. Security] Blocked unsafe command:', cmd);
      return resolve({
        success: false,
        action: 'run_command',
        blocked: true,
        message: "I blocked that command to keep your laptop safe, Ma'am."
      });
    }

    const ps = spawn('powershell.exe', ['-NoProfile', '-Command', cmd]);
    let stdout = '';
    let stderr = '';

    const timer = setTimeout(() => {
      try { ps.kill(); } catch (e) {}
      resolve({
        success: false,
        action: 'run_command',
        error: 'Execution timed out (15s limit).',
        message: "Command execution timed out after 15 seconds, Ma'am."
      });
    }, 15000);

    ps.stdout.on('data', (d) => { stdout += d.toString(); });
    ps.stderr.on('data', (d) => { stderr += d.toString(); });

    ps.on('close', (code) => {
      clearTimeout(timer);
      const cleanOut = stdout.trim().slice(0, 3000);
      const cleanErr = stderr.trim().slice(0, 1000);

      resolve({
        success: code === 0,
        action: 'run_command',
        exitCode: code,
        stdout: cleanOut,
        stderr: cleanErr,
        message: code === 0
          ? (cleanOut ? `Command output: ${cleanOut.slice(0, 200)}` : "Command executed successfully, Ma'am.")
          : `Command exited with code ${code}: ${cleanErr.slice(0, 150) || 'Execution error.'}`
      });
    });
  });
}

/**
 * 9. Native Windows Media & Volume Control
 */
function mediaControl(cmd) {
  return new Promise((resolve) => {
    let keyChar = null;
    let label = '';
    const raw = (cmd || '').toLowerCase();

    if (raw.includes('up') || raw.includes('increase') || raw.includes('louder')) {
      keyChar = 175;
      label = 'Volume increased';
    } else if (raw.includes('down') || raw.includes('decrease') || raw.includes('lower') || raw.includes('quieter')) {
      keyChar = 174;
      label = 'Volume decreased';
    } else if (raw.includes('mute') || raw.includes('unmute')) {
      keyChar = 173;
      label = 'Volume muted/unmuted';
    } else if (raw.includes('play') || raw.includes('pause') || raw.includes('resume')) {
      keyChar = 179;
      label = 'Media playback toggled';
    } else if (raw.includes('next') || raw.includes('skip')) {
      keyChar = 176;
      label = 'Skipped to next track';
    } else if (raw.includes('prev') || raw.includes('back')) {
      keyChar = 177;
      label = 'Returned to previous track';
    }

    if (!keyChar) {
      return resolve({ success: false, message: `Unrecognized media command: ${cmd}` });
    }

    const repeatCount = (keyChar === 175 || keyChar === 174) ? 4 : 1;
    const psScript = `
      $w = New-Object -ComObject WScript.Shell
      for ($i = 0; $i -lt ${repeatCount}; $i++) {
        $w.SendKeys([char]${keyChar})
      }
    `.trim();

    const ps = spawn('powershell.exe', ['-NoProfile', '-Command', psScript]);
    ps.on('close', (code) => {
      resolve({
        success: code === 0,
        action: 'media_control',
        message: `${label}, Ma'am.`
      });
    });
  });
}

/**
 * 10. Native Keyboard Typing & Shortcut Triggering
 */
function keyboardControl(text = '', keyCombo = '') {
  return new Promise((resolve) => {
    let script = 'Add-Type -AssemblyName System.Windows.Forms; ';

    if (keyCombo) {
      const comboMap = {
        'enter': '{ENTER}',
        'return': '{ENTER}',
        'tab': '{TAB}',
        'esc': '{ESC}',
        'escape': '{ESC}',
        'space': ' ',
        'backspace': '{BACKSPACE}',
        'ctrl+c': '^c',
        'ctrl+v': '^v',
        'ctrl+a': '^a',
        'ctrl+z': '^z',
        'alt+f4': '%{F4}',
        'win': '^{ESC}'
      };
      const mapped = comboMap[keyCombo.toLowerCase()] || keyCombo;
      script += `[System.Windows.Forms.SendKeys]::SendWait('${mapped}')`;
    } else if (text) {
      const escaped = text.replace(/([+^%~(){}])/g, '{$1}');
      script += `[System.Windows.Forms.SendKeys]::SendWait('${escaped.replace(/'/g, "''")}')`;
    } else {
      return resolve({ success: false, message: 'No text or key specified.' });
    }

    const ps = spawn('powershell.exe', ['-NoProfile', '-Command', script]);
    ps.on('close', (code) => {
      resolve({
        success: code === 0,
        action: 'keyboard_control',
        message: keyCombo ? `Triggered ${keyCombo}, Ma'am.` : `Typed into active window, Ma'am.`
      });
    });
  });
}

/**
 * 11. System File Search
 */
function searchFiles(query, folder = 'user') {
  return new Promise((resolve) => {
    try {
      let targetDir = USER_HOME;
      const f = (folder || '').toLowerCase();
      if (f.includes('desktop')) targetDir = DESKTOP_PATH;
      else if (f.includes('doc')) targetDir = DOCUMENTS_PATH;
      else if (f.includes('down')) targetDir = path.join(USER_HOME, 'Downloads');

      const safeQuery = (query || '').replace(/['"*]/g, '');
      if (!safeQuery) {
        return resolve({ success: false, message: 'Search query is required.' });
      }

      const script = `Get-ChildItem -Path '${targetDir}' -Filter '*${safeQuery}*' -Recurse -Depth 3 -ErrorAction SilentlyContinue | Select-Object -First 15 -Property Name, FullName, Length | ConvertTo-Json -Compress`;
      const ps = spawn('powershell.exe', ['-NoProfile', '-Command', script]);
      let stdout = '';

      ps.stdout.on('data', (d) => { stdout += d.toString(); });

      ps.on('close', () => {
        let items = [];
        try {
          if (stdout.trim()) {
            const parsed = JSON.parse(stdout);
            items = Array.isArray(parsed) ? parsed : [parsed];
          }
        } catch (e) {}

        const names = items.map((i) => i.Name).slice(0, 10);
        resolve({
          success: true,
          action: 'search_files',
          totalFound: items.length,
          files: items,
          message: items.length > 0
            ? `Found ${items.length} matching file${items.length > 1 ? 's' : ''}: ${names.join(', ')}, Ma'am.`
            : `No files matching "${query}" found in ${folder}, Ma'am.`
        });
      });
    } catch (err) {
      resolve({ success: false, error: err.message, message: `Search failed: ${err.message}` });
    }
  });
}

module.exports = {
  openApp,
  closeApp,
  launchBrowser,
  writeDesktopFile,
  readDesktopFile,
  listUserFiles,
  manageTasks,
  setReminder,
  systemControl,
  executeShellCommand,
  mediaControl,
  keyboardControl,
  searchFiles
};
