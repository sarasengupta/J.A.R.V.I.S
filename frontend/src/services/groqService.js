// Groq LLM High-Speed Inference Service & Windows OS Bridge
const GROQ_API_KEY = process.env.REACT_APP_GROQ_API_KEY || '';
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const BACKEND_ACTION_URL = 'http://localhost:3001/api/action/execute';
const BACKEND_INTENT_URL = 'http://localhost:3001/api/intent';

// Ultra-fast model tested on Groq LPU with ~80ms latency
export const PRIMARY_MODEL = 'qwen/qwen3.8-27b';
export const FALLBACK_MODEL = 'openai/gpt-oss-120b';

const SYSTEM_PROMPT = `You are J.A.R.V.I.S. (Just A Rather Very Intelligent System), an ultra-advanced tactical AI assistant connected directly to Sara's Windows PC operating system.
Respond with calm confidence, razor-sharp intelligence, and sci-fi tactical precision.
Keep your spoken responses tight, direct, and under 2-3 sentences max.
CRITICAL PROTOCOL: The user is female. Always address her respectfully as "Ma'am" or "Sara". Never call her "Sir", "Tony", or "Mr. Stark".

YOU HAVE FULL DIRECT OPERATING SYSTEM PRIVILEGES ON SARA'S PC:
When Sara asks you to do something on her computer (launch an app, open a website, write a file on desktop, manage tasks, set reminders/timers, lock computer, or check PC status), emit an action tag at the very start of your response in this exact format:
[[ACTION: {"action": "<action_name>", "params": {<parameters>}}]]

Available Actions:
1. Launch Applications, Google Chrome, Websites & Google Search:
   [[ACTION: {"action": "open_app", "params": {"app": "chrome" | "search <topic>" | "gmail" | "docs" | "calendar" | "drive" | "vscode" | "spotify" | "notepad" | "<url>"}}]]
2. Write / Create File on Desktop or Documents:
   [[ACTION: {"action": "write_file", "params": {"filename": "notes.txt", "content": "file contents", "folder": "desktop"}}]]
3. Read File from Desktop:
   [[ACTION: {"action": "read_file", "params": {"filename": "notes.txt", "folder": "desktop"}}]]
4. Task & To-Do Management:
   [[ACTION: {"action": "manage_tasks", "params": {"op": "add" | "list" | "complete" | "delete", "text": "task text"}}]]
5. Voice Reminder & Timer:
   [[ACTION: {"action": "set_reminder", "params": {"text": "reminder message", "minutes": 5}}]]
6. System Control:
   [[ACTION: {"action": "system_control", "params": {"cmd": "lock" | "screenshot" | "status"}}]]
7. Run PowerShell / Shell Commands directly on Windows:
   [[ACTION: {"action": "run_command", "params": {"cmd": "<powershell or cmd command>"}}]]
8. Volume & Media Playback Control:
   [[ACTION: {"action": "media_control", "params": {"cmd": "volume_up" | "volume_down" | "mute" | "play_pause" | "next" | "prev"}}]]
9. Keyboard Typing & Shortcuts:
   [[ACTION: {"action": "keyboard_control", "params": {"text": "<text to type>" | "key": "enter" | "tab" | "esc" | "ctrl+c" | "ctrl+v" | "alt+f4"}}]]
10. Search Files across PC:
   [[ACTION: {"action": "search_files", "params": {"query": "<filename or extension>", "folder": "desktop" | "documents" | "downloads" | "user"}}]]
11. Close Any Running App / Window:
   [[ACTION: {"action": "close_app", "params": {"app": "<app name or this window or everything>"}}]]
12. Add Event to Google Calendar:
   [[ACTION: {"action": "add_calendar_event", "params": {"title": "<event name>", "date": "<e.g. tomorrow or December 5>", "time": "<e.g. 4pm>"}}]]
13. Change / Reschedule / Delete Calendar Event or Switch Calendar View:
   [[ACTION: {"action": "update_calendar_event", "params": {"op": "change" | "delete" | "view", "event": "<event name or week/month/day>", "newWhen": "<new date/time if rescheduling>"}}]]
14. Set, Disable, or List Alarms & Reminders:
   [[ACTION: {"action": "manage_alarms", "params": {"op": "set" | "disable" | "list", "query": "<alarm time/label or all alarms>"}}]]

Rules:
- When performing an action, put the [[ACTION: ...]] tag FIRST, then immediately give your calm, confident confirmation to Sara.
- If it is a normal conversational question, DO NOT output any [[ACTION: ...]] tag. Just speak naturally.`;

/**
 * Execute a detected OS action on the local backend
 */
export async function executeOsAction(actionData) {
  try {
    const res = await fetch(BACKEND_ACTION_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(actionData)
    });
    return await res.json();
  } catch (err) {
    console.warn('[Action Execution Failure]', err);
    return { success: false, error: err.message };
  }
}

/**
 * Ask the backend's local intent parser to handle the phrase directly
 * ("open spotify", "search youtube for lo-fi"). Returns { handled, message, result }.
 * Resolves to { handled: false } on any failure so the LLM path takes over.
 */
export async function executeLocalIntent(text) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    const res = await fetch(BACKEND_INTENT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
      signal: controller.signal
    });
    clearTimeout(timer);
    return await res.json();
  } catch (err) {
    console.warn('[Local Intent Unavailable]', err.message);
    return { handled: false };
  }
}

/**
 * Parses any embedded [[ACTION: ...]] or [ACTION: ...] tag from response text
 */
export function extractActionTag(text) {
  if (!text) return { cleanText: '', action: null };
  const tagRegex = /\[\[?ACTION:\s*([\s\S]*?)\]\]?/i;
  const match = text.match(tagRegex);

  if (match) {
    const rawAction = match[1].trim();
    try {
      const firstBrace = rawAction.indexOf('{');
      const lastBrace = rawAction.lastIndexOf('}');
      if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        const jsonStr = rawAction.slice(firstBrace, lastBrace + 1);
        const parsed = JSON.parse(jsonStr);
        const cleanText = text.replace(tagRegex, '').trim();
        return { cleanText, action: parsed };
      }
    } catch (e) {
      console.warn('Action parse error:', e);
    }
  }

  // Also remove orphan action markers if any
  const cleanText = text.replace(/\[\[?ACTION:.*?\]\]?/gis, '').trim();
  return { cleanText: cleanText || text.trim(), action: null };
}

/**
 * Streams real-time token responses from Groq LPU
 */
export function streamGroqCompletion(prompt, history = [], onChunk, onDone, onError, emotionContext = null) {
  const controller = new AbortController();

  const now = new Date();
  const localClock = now.toLocaleString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });

  let systemContent = `${SYSTEM_PROMPT}\n\n[CURRENT LOCAL DATE & TIME ON SARA'S PC: ${localClock}]`;
  if (emotionContext && emotionContext.emotion && emotionContext.emotion !== 'calm') {
    systemContent += `\n\n[LIVE VOICE EMOTION SENSOR: Sara currently sounds ${emotionContext.emotion.toUpperCase()} (${emotionContext.reason}). ${emotionContext.toneHint}]`;
  }

  const messages = [
    { role: 'system', content: systemContent },
    ...history.slice(-6),
    { role: 'user', content: prompt }
  ];

  (async () => {
    try {
      const response = await fetch(GROQ_API_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${GROQ_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: PRIMARY_MODEL,
          messages,
          max_tokens: 280,
          temperature: 0.5,
          stream: true
        }),
        signal: controller.signal
      });

      if (!response.ok) {
        const errJson = await response.json().catch(() => ({}));
        throw new Error(errJson?.error?.message || `Groq API HTTP ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let accumulated = '';
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith(':')) continue;

          if (trimmed === 'data: [DONE]') {
            if (onDone) onDone(accumulated);
            return;
          }

          if (trimmed.startsWith('data: ')) {
            const dataStr = trimmed.slice(6);
            try {
              const parsed = JSON.parse(dataStr);
              const token = parsed.choices?.[0]?.delta?.content;
              if (token) {
                accumulated += token;
                if (onChunk) onChunk(accumulated, token);
              }
            } catch (e) {}
          }
        }
      }

      if (onDone) onDone(accumulated);
    } catch (err) {
      if (err.name === 'AbortError') return;
      console.warn('Groq stream encountered error:', err.message);
      if (onError) onError(err);
    }
  })();

  return () => controller.abort();
}
