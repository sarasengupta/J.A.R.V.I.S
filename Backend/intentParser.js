// J.A.R.V.I.S. Local Intent Parser
// Recognises "open / launch / start <app>" and "search <query>" phrases directly,
// so app launching works instantly and reliably without waiting on the LLM.
// Anything it can't confidently handle is passed back (handled: false) for the LLM.

const registry = require('./appRegistry');
const actions = require('./actions');

const WAKE_PREFIX = /^(?:(?:hey|hi|ok|okay|yo)\s+)?(?:jarvis|travis|javis|jarves)\b[\s,:]*/i;
const POLITE_PREFIX = /^(?:(?:please|can you|could you|would you|will you|i want you to|i need you to|go ahead and)\s+)+/i;
const CALENDAR_ADD_1 = /^(?:add|put|create|save|set)\s+(.+?)\s+(?:to|on|in)\s+(?:my\s+|the\s+)?(?:google\s+)?calendar(?:\s+(.*))?$/i;
const CALENDAR_ADD_2 = /^(?:schedule|book)\s+(?:a\s+|an\s+)?(.+?)(?:\s+(?:on|in|to)\s+(?:my\s+|the\s+)?(?:google\s+)?calendar)?$/i;
const CALENDAR_VIEW = /^(?:change|switch|set|show)\s+(?:my\s+|the\s+)?(?:google\s+)?calendar\s+(?:view\s+)?to\s+(day|week|month|year|schedule|agenda)(?:\s+view)?$/i;
const CALENDAR_CHANGE = /^(?:change|reschedule|move|edit|update)\s+(.+?)(?:\s+(?:on|in)\s+(?:my\s+|the\s+)?(?:google\s+)?calendar)?(?:\s+to\s+(.+))?$/i;
const CALENDAR_DELETE = /^(?:delete|remove|cancel)\s+(.+?)\s+(?:from|on|in)\s+(?:my\s+|the\s+)?(?:google\s+)?calendar$/i;
const ALARM_DISABLE = /^(?:disable|turn\s+off|switch\s+off|stop|cancel|delete|dismiss|clear)\s+(?:all\s+|my\s+|the\s+)?(.*?\b(?:alarms?|reminders?)\b.*)$/i;
const ALARM_SET = /^(?:set\s+(?:an?\s+)?alarm(?:\s+for)?|wake\s+me\s+up(?:\s+at)?)\s+(.+)$/i;
const ALARM_LIST = /^(?:list|show|check|what\s+are)\s+(?:my\s+|all\s+)?alarms?$/i;
const MINIMIZE_VERB = /^(?:minimize|minimise|hide|shrink)(?:\s+(.+))?$/i;
const MAXIMIZE_VERB = /^(?:maximize|maximise|full\s*screen|expand|enlarge)(?:\s+(.+))?$/i;
const RESTORE_VERB = /^(?:restore|unminimize|unminimise|bring\s+back)(?:\s+(.+))?$/i;
const GO_BACKGROUND = /^(?:go\s+(?:to|into)\s+(?:the\s+)?background|work\s+in\s+(?:the\s+)?background|run\s+in\s+(?:the\s+)?background)$/i;
const SHOW_DESKTOP = /^(?:show\s+(?:my\s+|the\s+)?desktop)$/i;
const TIME_QUERY = /^(?:what\s+time\s+is\s+it(?:\s+(?:right\s+)?now)?|what(?:'?s| is)\s+(?:the\s+)?(?:current\s+)?time(?:\s+(?:right\s+)?now)?|tell\s+me\s+the\s+time|current\s+time|time\s+now|time\s+please)$/i;
const DATE_QUERY = /^(?:what(?:'?s| is)?\s+(?:today'?s\s+)?(?:the\s+)?(?:current\s+)?date|what\s+day\s+(?:is\s+it|is\s+today)|tell\s+me\s+(?:the\s+|today'?s\s+)?date|today'?s\s+date)$/i;
const DATETIME_QUERY = /^(?:what(?:'?s| is)?\s+(?:the\s+)?(?:date\s+and\s+time|time\s+and\s+date))$/i;
const OPEN_VERBS = /^(?:open(?:\s+up)?|launch|start(?:\s+up)?|run|fire\s+up|pull\s+up|bring\s+up|boot\s+up|load(?:\s+up)?|go\s+to|show(?:\s+me)?)\s+(.+)$/i;
const CLOSE_VERBS = /^(?:close(?:\s+down)?|quit|exit|shut\s+down|kill|end|terminate)\s+(.+)$/i;
const SYSTEM_TARGET = /\b(computer|laptop|pc|windows|system|jarvis|yourself)\b/i;
const SITE_SEARCH = /^(?:search|look\s+up|find)\s+(youtube|google|amazon|github|reddit)\s+for\s+(.+)$/i;
const SEARCH_ON_SITE = /^(?:search(?:\s+for)?|look\s+up|find)\s+(.+?)\s+on\s+(youtube|google|amazon|github|reddit)$/i;
const WEB_SEARCH = /^(?:search(?:\s+the\s+web)?(?:\s+for)?|google|look\s+up)\s+(.+)$/i;
const TRAILING_FILLER = /(?:\s+(?:in|on|from|via|using)\s+(?:google\s+)?(?:chrome|browser)|\s+(?:for\s+me|please|now|right\s+now|quickly|app|application|program))+$/i;
const FILE_REQUEST = /\b(file|files on|folder|document|on (?:my |the )?desktop|in (?:my |the )?documents)\b|\.(txt|pdf|docx?|xlsx?|pptx?|png|jpe?g|mp[34])\b/i;

const SEARCH_URLS = {
  google: (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}`,
  youtube: (q) => `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`,
  amazon: (q) => `https://www.amazon.in/s?k=${encodeURIComponent(q)}`,
  github: (q) => `https://github.com/search?q=${encodeURIComponent(q)}`,
  reddit: (q) => `https://www.reddit.com/search/?q=${encodeURIComponent(q)}`
};

function clean(text) {
  return (text || '')
    .trim()
    .replace(/[.!?]+$/, '')
    .replace(WAKE_PREFIX, '')
    .replace(POLITE_PREFIX, '')
    .trim();
}

/**
 * Parse a transcript into a structured intent, or null if not recognised.
 */
function parseIntent(text) {
  const t = clean(text);
  if (!t) return null;

  if (DATETIME_QUERY.test(t)) return { intent: 'get_time', mode: 'datetime' };
  if (TIME_QUERY.test(t)) return { intent: 'get_time', mode: 'time' };
  if (DATE_QUERY.test(t)) return { intent: 'get_time', mode: 'date' };

  let m = t.match(ALARM_DISABLE);
  if (m) return { intent: 'manage_alarms', op: 'disable', query: m[1].trim() };

  m = t.match(ALARM_SET);
  if (m) return { intent: 'manage_alarms', op: 'set', query: m[1].replace(TRAILING_FILLER, '').trim() };

  if (ALARM_LIST.test(t)) return { intent: 'manage_alarms', op: 'list', query: '' };

  if (GO_BACKGROUND.test(t)) return { intent: 'window_control', op: 'minimize', target: 'jarvis' };
  if (SHOW_DESKTOP.test(t)) return { intent: 'window_control', op: 'minimize', target: 'everything' };

  m = t.match(MINIMIZE_VERB);
  if (m) {
    const target = (m[1] || 'this window').replace(TRAILING_FILLER, '').replace(/^(?:the|my)\s+/i, '').trim();
    return { intent: 'window_control', op: 'minimize', target: target || 'this window' };
  }

  m = t.match(MAXIMIZE_VERB);
  if (m) {
    const target = (m[1] || 'this window').replace(TRAILING_FILLER, '').replace(/^(?:the|my)\s+/i, '').trim();
    return { intent: 'window_control', op: 'maximize', target: target || 'this window' };
  }

  m = t.match(RESTORE_VERB);
  if (m) {
    const target = (m[1] || 'jarvis').replace(TRAILING_FILLER, '').replace(/^(?:the|my)\s+/i, '').trim();
    return { intent: 'window_control', op: 'restore', target: target || 'jarvis' };
  }

  m = t.match(CALENDAR_VIEW);
  if (m) return { intent: 'update_calendar_event', op: 'view', event: m[1].toLowerCase() };

  m = t.match(CALENDAR_DELETE);
  if (m) return { intent: 'update_calendar_event', op: 'delete', event: m[1].trim() };

  m = t.match(CALENDAR_CHANGE);
  if (m && (/\bcalendar\b/i.test(t) || /^(?:reschedule|move)\b/i.test(t))) {
    return { intent: 'update_calendar_event', op: 'change', event: m[1].trim(), newWhen: (m[2] || '').trim() };
  }

  m = t.match(CALENDAR_ADD_1);
  if (m) {
    const rawEvent = [m[1], m[2]].filter(Boolean).join(' ').replace(TRAILING_FILLER, '').trim();
    if (rawEvent) return { intent: 'add_calendar_event', event: rawEvent };
  }

  m = t.match(CALENDAR_ADD_2);
  if (m) {
    const rawEvent = m[1].replace(TRAILING_FILLER, '').trim();
    if (rawEvent) return { intent: 'add_calendar_event', event: rawEvent };
  }

  m = t.match(SITE_SEARCH);
  if (m) return { intent: 'web_search', engine: m[1].toLowerCase(), query: m[2].replace(TRAILING_FILLER, '').trim() };

  m = t.match(SEARCH_ON_SITE);
  if (m) return { intent: 'web_search', engine: m[2].toLowerCase(), query: m[1].replace(TRAILING_FILLER, '').trim() };

  m = t.match(CLOSE_VERBS);
  if (m) {
    const target = m[1].replace(TRAILING_FILLER, '').replace(/^(?:the|my)\s+/i, '').trim();
    if (target && !SYSTEM_TARGET.test(target)) return { intent: 'close_app', target };
  }

  m = t.match(OPEN_VERBS);
  if (m) {
    const target = m[1].replace(TRAILING_FILLER, '').replace(/^(?:the|my)\s+/i, '').trim();
    // File/folder requests ("open my notes file on desktop") belong to the LLM's file tools
    if (FILE_REQUEST.test(target)) return null;
    if (target) return { intent: 'open_app', target };
  }

  m = t.match(WEB_SEARCH);
  if (m) return { intent: 'web_search', engine: 'google', query: m[1].replace(TRAILING_FILLER, '').trim() };

  return null;
}

/**
 * Parse and, if confident, execute the intent.
 * Returns { handled: true, ... } when an action ran, otherwise { handled: false }.
 */
async function handleIntent(text) {
  const parsed = parseIntent(text);
  if (!parsed) return { handled: false };

  if (parsed.intent === 'get_time') {
    const now = new Date();
    const timeStr = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    let message = `It is ${timeStr}, Ma'am.`;
    if (parsed.mode === 'date') message = `Today is ${dateStr}, Ma'am.`;
    if (parsed.mode === 'datetime') message = `It is ${timeStr} on ${dateStr}, Ma'am.`;
    return {
      handled: true,
      intent: parsed,
      result: { success: true, time: timeStr, date: dateStr },
      message
    };
  }

  if (parsed.intent === 'window_control') {
    const result = await actions.windowControl(parsed.op, parsed.target);
    return { handled: true, intent: parsed, result, message: result.message };
  }

  if (parsed.intent === 'manage_alarms') {
    const result = await actions.manageAlarms(parsed.op, parsed.query);
    return { handled: true, intent: parsed, result, message: result.message };
  }

  if (parsed.intent === 'update_calendar_event') {
    const result = await actions.updateCalendarEvent(parsed.op, parsed.event, parsed.newWhen);
    return { handled: true, intent: parsed, result, message: result.message };
  }

  if (parsed.intent === 'add_calendar_event') {
    const result = await actions.addCalendarEvent(parsed.event);
    return { handled: true, intent: parsed, result, message: result.message };
  }

  if (parsed.intent === 'web_search' && parsed.query) {
    const url = SEARCH_URLS[parsed.engine](parsed.query);
    const result = await registry.launchUrl(url);
    const where = parsed.engine === 'google' ? '' : ` on ${parsed.engine[0].toUpperCase()}${parsed.engine.slice(1)}`;
    return {
      handled: true,
      intent: parsed,
      result,
      message: result.success ? `Searching for ${parsed.query}${where}, Ma'am.` : result.message
    };
  }

  if (parsed.intent === 'close_app') {
    const result = await registry.closeApp(parsed.target);
    return { handled: true, intent: parsed, result, message: result.message };
  }

  if (parsed.intent === 'open_app') {
    // Only take over when the target actually maps to a known app/site; otherwise
    // let the LLM interpret it (e.g. "start a timer", "run a diagnostic").
    const match = registry.resolveApp(parsed.target);
    if (!match) return { handled: false, intent: parsed, reason: 'no matching app' };

    const result = await registry.launchApp(parsed.target);
    return { handled: true, intent: parsed, result, message: result.message };
  }

  return { handled: false };
}

module.exports = { parseIntent, handleIntent };
