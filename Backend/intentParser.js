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

  let m = t.match(CALENDAR_ADD_1);
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
