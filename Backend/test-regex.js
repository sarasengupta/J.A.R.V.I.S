const str = '[[ACTION: {"action": "open_app", "params": {"app": "youtube"}}]] Opening YouTube for you, Ma\'am.';

// Non-greedy vs bracket-aware
const regexNonGreedy = /\[\[ACTION:\s*(\{.*?\})\s*\]\]/s;
console.log('Non-greedy regex match[1]:', str.match(regexNonGreedy)?.[1]);

// Proper regex matching between [[ACTION: and ]]
const regexFixed = /\[\[ACTION:\s*(.*?)\s*\]\]/s;
const matchFixed = str.match(regexFixed);
console.log('Fixed regex match[1]:', matchFixed?.[1]);
if (matchFixed) {
  try {
    const parsed = JSON.parse(matchFixed[1]);
    console.log('Successfully parsed JSON:', parsed);
    const clean = str.replace(regexFixed, '').trim();
    console.log('Clean text to speak:', clean);
  } catch (e) {
    console.error('Parse error:', e.message);
  }
}
