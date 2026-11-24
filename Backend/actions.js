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
 * 1c. Google Calendar Event Creator (opens pre-filled event in Google Chrome)
 */
const CALENDAR_LOG_FILE = path.join(__dirname, 'calendar_events.json');

function pad2(n) {
  return String(n).padStart(2, '0');
}

function toGCalDateTime(d) {
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}T${pad2(d.getHours())}${pad2(d.getMinutes())}00`;
}

function toGCalAllDay(d) {
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`;
}

function parseNaturalDateTime(text) {
  const now = new Date();
  let target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 0, 0, 0);
  let hasTime = false;
  let durationMin = 60;
  let title = (text || '').trim();

  // Duration: "for 2 hours" / "for 30 minutes"
  const durM = title.match(/\bfor\s+(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|m)\b/i);
  if (durM) {
    const val = parseFloat(durM[1]);
    durationMin = /^h/i.test(durM[2]) ? Math.round(val * 60) : Math.round(val);
    title = title.replace(durM[0], ' ');
  }

  // Date: today / tomorrow / day after tomorrow
  if (/\bday after tomorrow\b/i.test(title)) {
    target.setDate(target.getDate() + 2);
    title = title.replace(/\b(?:on\s+)?day after tomorrow\b/i, ' ');
  } else if (/\btomorrow\b/i.test(title)) {
    target.setDate(target.getDate() + 1);
    title = title.replace(/\b(?:on\s+)?tomorrow\b/i, ' ');
  } else if (/\btoday\b|\btonight\b/i.test(title)) {
    if (/\btonight\b/i.test(title)) {
      target.setHours(20, 0, 0, 0);
      hasTime = true;
    }
    title = title.replace(/\b(?:on\s+)?(?:today|tonight)\b/i, ' ');
  } else {
    // Weekday: "on Friday", "next Monday"
    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const dayRe = new RegExp(`\\b(?:on\\s+|next\\s+|this\\s+)?(${days.join('|')})\\b`, 'i');
    const dm = title.match(dayRe);
    if (dm) {
      const want = days.indexOf(dm[1].toLowerCase());
      let diff = (want - now.getDay() + 7) % 7;
      if (diff === 0) diff = 7;
      target.setDate(target.getDate() + diff);
      title = title.replace(dm[0], ' ');
    } else {
      // Month + day: "December 5" or "5th December"
      const months = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
      const shortM = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
      const mNames = [...months, ...shortM].join('|');
      const m1 = title.match(new RegExp(`\\b(?:on\\s+)?(${mNames})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, 'i'));
      const m2 = !m1 && title.match(new RegExp(`\\b(?:on\\s+)?(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${mNames})\\b`, 'i'));
      if (m1 || m2) {
        const mStr = (m1 ? m1[1] : m2[2]).toLowerCase();
        const dayNum = parseInt(m1 ? m1[2] : m2[1], 10);
        let monthIdx = months.indexOf(mStr);
        if (monthIdx < 0) monthIdx = shortM.indexOf(mStr);
        if (monthIdx >= 0 && dayNum >= 1 && dayNum <= 31) {
          target = new Date(now.getFullYear(), monthIdx, dayNum, 9, 0, 0, 0);
          if (target < new Date(now.getFullYear(), now.getMonth(), now.getDate())) {
            target.setFullYear(target.getFullYear() + 1);
          }
          title = title.replace((m1 || m2)[0], ' ');
        }
      }
    }
  }

  // Time: "at 4pm", "at 10:30 am", "at 18:00", "at noon"
  const timeM = title.match(/\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\b/i)
    || title.match(/\bat\s+(\d{1,2}):(\d{2})\b/i);
  if (timeM) {
    let hr = parseInt(timeM[1], 10);
    const min = timeM[2] ? parseInt(timeM[2], 10) : 0;
    const ampm = (timeM[3] || '').replace(/\./g, '').toLowerCase();
    if (ampm === 'pm' && hr < 12) hr += 12;
    if (ampm === 'am' && hr === 12) hr = 0;
    target.setHours(hr, min, 0, 0);
    hasTime = true;
    title = title.replace(timeM[0], ' ');
  } else if (/\b(?:at\s+)?noon\b/i.test(title)) {
    target.setHours(12, 0, 0, 0);
    hasTime = true;
    title = title.replace(/\b(?:at\s+)?noon\b/i, ' ');
  } else if (/\b(?:at\s+)?midnight\b/i.test(title)) {
    target.setHours(0, 0, 0, 0);
    hasTime = true;
    title = title.replace(/\b(?:at\s+)?midnight\b/i, ' ');
  }

  title = title.replace(/\s+/g, ' ').replace(/^(?:a|an|the|my)\s+/i, '').trim();
  return { title: title || 'New Event', start: target, hasTime, durationMin };
}

async function addCalendarEvent(rawInput, explicitDate, explicitTime, explicitDetails = '') {
  const combined = [rawInput, explicitDate, explicitTime].filter(Boolean).join(' ');
  const parsed = parseNaturalDateTime(combined);

  let datesParam = '';
  let readableWhen = '';
  if (parsed.hasTime) {
    const end = new Date(parsed.start.getTime() + parsed.durationMin * 60 * 1000);
    datesParam = `${toGCalDateTime(parsed.start)}/${toGCalDateTime(end)}`;
    readableWhen = parsed.start.toLocaleString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
    });
  } else {
    const nextDay = new Date(parsed.start.getFullYear(), parsed.start.getMonth(), parsed.start.getDate() + 1);
    datesParam = `${toGCalAllDay(parsed.start)}/${toGCalAllDay(nextDay)}`;
    readableWhen = parsed.start.toLocaleDateString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric'
    });
  }

  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: parsed.title,
    dates: datesParam,
    details: explicitDetails || 'Scheduled via J.A.R.V.I.S.'
  });
  const url = `https://calendar.google.com/calendar/render?${params.toString()}`;

  // Save a local record as well
  try {
    const existing = fs.existsSync(CALENDAR_LOG_FILE)
      ? JSON.parse(fs.readFileSync(CALENDAR_LOG_FILE, 'utf-8') || '[]')
      : [];
    existing.push({
      id: Date.now(),
      title: parsed.title,
      when: readableWhen,
      url,
      createdAt: new Date().toISOString()
    });
    fs.writeFileSync(CALENDAR_LOG_FILE, JSON.stringify(existing, null, 2), 'utf-8');
  } catch (e) {}

  const launch = await registry.launchUrl(url);
  return {
    success: launch.success,
    action: 'add_calendar_event',
    title: parsed.title,
    when: readableWhen,
    url,
    message: launch.success
      ? `Opened Google Calendar to add "${parsed.title}" for ${readableWhen}, Ma'am. Just click Save.`
      : `Could not open Google Calendar: ${launch.error}`
  };
}

/**
 * 1d. Change / Reschedule / Delete Google Calendar Events & Switch Views
 */
async function updateCalendarEvent(op = 'change', eventQuery = '', newWhen = '') {
  const mode = (op || 'change').toLowerCase();

  // Switch Google Calendar view (day / week / month / agenda)
  if (mode === 'view') {
    const viewMap = { day: 'day', week: 'week', month: 'month', year: 'year', schedule: 'agenda', agenda: 'agenda' };
    const v = viewMap[(eventQuery || '').toLowerCase()] || 'week';
    const url = `https://calendar.google.com/calendar/u/0/r/${v}`;
    const launch = await registry.launchUrl(url);
    return {
      success: launch.success,
      action: 'update_calendar_event',
      view: v,
      url,
      message: launch.success ? `Switched your Google Calendar to ${v} view, Ma'am.` : `Could not open Google Calendar.`
    };
  }

  const cleanEvent = (eventQuery || '').trim();
  if (!cleanEvent) {
    const launch = await registry.launchUrl('https://calendar.google.com/calendar/u/0/r');
    return {
      success: launch.success,
      action: 'update_calendar_event',
      message: "Opened your Google Calendar so you can edit it, Ma'am."
    };
  }

  // Update or remove from local calendar log
  try {
    if (fs.existsSync(CALENDAR_LOG_FILE)) {
      let events = JSON.parse(fs.readFileSync(CALENDAR_LOG_FILE, 'utf-8') || '[]');
      if (mode === 'delete' || mode === 'remove' || mode === 'cancel') {
        events = events.filter((e) => !e.title.toLowerCase().includes(cleanEvent.toLowerCase()));
      } else if (newWhen) {
        const found = events.find((e) => e.title.toLowerCase().includes(cleanEvent.toLowerCase()));
        if (found) found.when = newWhen;
      }
      fs.writeFileSync(CALENDAR_LOG_FILE, JSON.stringify(events, null, 2), 'utf-8');
    }
  } catch (e) {}

  if (mode === 'delete' || mode === 'remove' || mode === 'cancel') {
    const searchUrl = `https://calendar.google.com/calendar/u/0/r/search?q=${encodeURIComponent(cleanEvent)}`;
    const launch = await registry.launchUrl(searchUrl);
    return {
      success: launch.success,
      action: 'update_calendar_event',
      mode: 'delete',
      event: cleanEvent,
      url: searchUrl,
      message: launch.success
        ? `Opened "${cleanEvent}" in your Google Calendar so you can delete it in one click, Ma'am.`
        : `Could not open Google Calendar.`
    };
  }

  // Reschedule / change event: if a new time was given, open pre-filled updated event; otherwise search it
  if (newWhen && newWhen.trim()) {
    return addCalendarEvent(`${cleanEvent} ${newWhen}`, '', '', 'Rescheduled via J.A.R.V.I.S.');
  }

  const searchUrl = `https://calendar.google.com/calendar/u/0/r/search?q=${encodeURIComponent(cleanEvent)}`;
  const launch = await registry.launchUrl(searchUrl);
  return {
    success: launch.success,
    action: 'update_calendar_event',
    mode: 'change',
    event: cleanEvent,
    url: searchUrl,
    message: launch.success
      ? `Opened "${cleanEvent}" in your Google Calendar for editing, Ma'am.`
      : `Could not open Google Calendar.`
  };
}

/**
 * 1e. Alarm Management (Set, Disable/Cancel, List) + Windows Clock Integration
 */
const ALARMS_FILE = path.join(__dirname, 'alarms.json');
const activeAlarmHandles = new Map();

function loadAlarms() {
  try {
    if (fs.existsSync(ALARMS_FILE)) {
      return JSON.parse(fs.readFileSync(ALARMS_FILE, 'utf-8') || '[]');
    }
  } catch (e) {}
  return [];
}

function saveAlarms(list) {
  try {
    fs.writeFileSync(ALARMS_FILE, JSON.stringify(list, null, 2), 'utf-8');
  } catch (e) {}
}

async function manageAlarms(op = 'list', rawInput = '') {
  const mode = (op || 'list').toLowerCase();
  let alarms = loadAlarms();

  // Disable / cancel / turn off alarms & active reminders
  if (mode === 'disable' || mode === 'cancel' || mode === 'delete' || mode === 'off') {
    const q = (rawInput || '').toLowerCase().trim();
    const disableAll = !q || /^(?:all|every|my|the)?\s*(?:alarms?|reminders?)$/i.test(q);
    let disabledCount = 0;

    for (const alarm of alarms) {
      if (alarm.enabled && (disableAll || alarm.label.toLowerCase().includes(q) || alarm.timeText.toLowerCase().includes(q))) {
        alarm.enabled = false;
        disabledCount++;
        const handle = activeAlarmHandles.get(alarm.id);
        if (handle) {
          clearTimeout(handle);
          activeAlarmHandles.delete(alarm.id);
        }
      }
    }
    saveAlarms(alarms);

    // Also cancel active J.A.R.V.I.S. reminders if requested
    let reminderCount = 0;
    for (const [id, item] of activeTimers.entries()) {
      if (disableAll || (item.text && item.text.toLowerCase().includes(q))) {
        clearTimeout(item.handle);
        activeTimers.delete(id);
        reminderCount++;
      }
    }

    const total = disabledCount + reminderCount;
    if (total > 0) {
      return {
        success: true,
        action: 'manage_alarms',
        op: 'disable',
        disabledCount: total,
        message: `Disabled ${total} alarm${total > 1 ? 's' : ''}, Ma'am.`
      };
    }

    // If no J.A.R.V.I.S. alarms were active, open Windows Clock Alarms so Sara can toggle system alarms directly
    await registry.launchApp('clock');
    return {
      success: true,
      action: 'manage_alarms',
      op: 'disable',
      disabledCount: 0,
      openedClock: true,
      message: "You had no active J.A.R.V.I.S. alarms, so I opened Windows Clock so you can switch off any system alarms, Ma'am."
    };
  }

  // Set a new alarm
  if (mode === 'set' || mode === 'add') {
    const parsed = parseNaturalDateTime(rawInput);
    const now = new Date();
    let triggerAt = parsed.start;
    if (triggerAt <= now) {
      triggerAt = new Date(triggerAt.getTime() + 24 * 60 * 60 * 1000);
    }
    const delayMs = triggerAt.getTime() - now.getTime();
    const timeText = triggerAt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    const label = parsed.title && parsed.title !== 'New Event' ? parsed.title : `Alarm for ${timeText}`;
    const id = Date.now();

    const alarm = { id, label, timeText, triggerAt: triggerAt.toISOString(), enabled: true };
    alarms.push(alarm);
    saveAlarms(alarms);

    if (delayMs > 0 && delayMs < 2147483647) {
      const handle = setTimeout(() => {
        activeAlarmHandles.delete(id);
        const cur = loadAlarms().map((a) => (a.id === id ? { ...a, enabled: false } : a));
        saveAlarms(cur);
        const safeLabel = label.replace(/['"]/g, '');
        const ps = `Add-Type -AssemblyName PresentationCore; [console]::beep(880,500); [console]::beep(1046,600); [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null; $xml = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02); $t = $xml.GetElementsByTagName('text'); $t[0].AppendChild($xml.CreateTextNode('J.A.R.V.I.S. Alarm')) > $null; $t[1].AppendChild($xml.CreateTextNode('${safeLabel}')) > $null; [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('J.A.R.V.I.S.').Show([Windows.UI.Notifications.ToastNotification]::new($xml))`;
        exec(`powershell -NoProfile -Command "${ps}"`, { windowsHide: true }, () => {});
      }, delayMs);
      activeAlarmHandles.set(id, handle);
    }

    return {
      success: true,
      action: 'manage_alarms',
      op: 'set',
      alarm,
      message: `Alarm set for ${timeText}, Ma'am.`
    };
  }

  // List active alarms
  const enabled = alarms.filter((a) => a.enabled);
  return {
    success: true,
    action: 'manage_alarms',
    op: 'list',
    alarms: enabled,
    message: enabled.length > 0
      ? `You have ${enabled.length} active alarm${enabled.length > 1 ? 's' : ''}: ${enabled.map((a) => a.timeText).join(', ')}, Ma'am.`
      : "You have no active alarms set right now, Ma'am."
  };
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
  addCalendarEvent,
  updateCalendarEvent,
  manageAlarms,
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
