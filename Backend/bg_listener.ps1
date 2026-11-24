# J.A.R.V.I.S. Native Windows Background Voice Listener (Continuous RecognizeAsync)
# Runs whenever the J.A.R.V.I.S. window loses focus or is minimized, completely outside Chrome.
Add-Type -AssemblyName System.Speech

$culture = New-Object System.Globalization.CultureInfo("en-US")
$engine = New-Object System.Speech.Recognition.SpeechRecognitionEngine($culture)

# Wake phrases (including soft/whispered phonetics)
$wake = New-Object System.Speech.Recognition.Choices("hey jarvis", "jarvis", "okay jarvis", "hi jarvis")

$apps = New-Object System.Speech.Recognition.Choices(
    "youtube", "chrome", "google chrome", "calculator", "notepad", "spotify",
    "vs code", "code", "downloads", "documents", "desktop", "settings",
    "calendar", "gmail", "canva", "notion", "netflix", "instagram",
    "chatgpt", "claude", "file explorer", "explorer", "task manager",
    "clock", "camera", "paint", "word", "excel", "discord", "whatsapp",
    "github", "google", "google docs", "google drive", "amazon", "reddit"
)

$closeTargets = New-Object System.Speech.Recognition.Choices(
    "youtube", "chrome", "calculator", "notepad", "spotify", "vs code",
    "word", "excel", "discord", "whatsapp", "settings", "clock", "camera",
    "paint", "tab", "this tab", "this window", "everything", "all apps"
)

$winTargets = New-Object System.Speech.Recognition.Choices(
    "tab", "this tab", "this window", "youtube", "chrome", "calculator",
    "notepad", "spotify", "vs code", "everything", "jarvis"
)

# 1. Open <app>
$gbOpen = New-Object System.Speech.Recognition.GrammarBuilder
$gbOpen.Append($wake)
$gbOpen.Append((New-Object System.Speech.Recognition.Choices("open", "launch", "start")))
$gbOpen.Append($apps)

# 2. Close <app/tab>
$gbClose = New-Object System.Speech.Recognition.GrammarBuilder
$gbClose.Append($wake)
$gbClose.Append((New-Object System.Speech.Recognition.Choices("close", "quit", "exit")))
$gbClose.Append($closeTargets)

# 3. Minimize / Maximize / Restore <window/tab>
$gbWin = New-Object System.Speech.Recognition.GrammarBuilder
$gbWin.Append($wake)
$gbWin.Append((New-Object System.Speech.Recognition.Choices("minimize", "maximize", "restore", "bring back")))
$gbWin.Append($winTargets)

# 4. Direct commands (time, date, alarms, media, system)
$directPhrases = New-Object System.Speech.Recognition.Choices(
    "what time is it", "what is the time", "what is today's date", "what day is it",
    "disable my alarms", "turn off all alarms", "list my alarms",
    "volume up", "volume down", "mute", "play", "pause", "next track", "previous track",
    "take a screenshot", "lock computer", "show desktop", "bring back jarvis", "maximize jarvis"
)
$gbDirect = New-Object System.Speech.Recognition.GrammarBuilder
$gbDirect.Append($wake)
$gbDirect.Append($directPhrases)

$engine.LoadGrammar((New-Object System.Speech.Recognition.Grammar($gbOpen)))
$engine.LoadGrammar((New-Object System.Speech.Recognition.Grammar($gbClose)))
$engine.LoadGrammar((New-Object System.Speech.Recognition.Grammar($gbWin)))
$engine.LoadGrammar((New-Object System.Speech.Recognition.Grammar($gbDirect)))

$engine.SetInputToDefaultAudioDevice()

# Continuous asynchronous recognition (zero 5s timeout cutoffs!)
Register-ObjectEvent -InputObject $engine -EventName SpeechRecognized -Action {
    $res = $Event.SourceEventArgs.Result
    if ($res -and $res.Confidence -ge 0.35) {
        [Console]::Out.WriteLine("CMD:" + $res.Text)
        [Console]::Out.Flush()
    }
} | Out-Null

$engine.RecognizeAsync([System.Speech.Recognition.RecognizeMode]::Multiple)
[Console]::Out.WriteLine("BG_VOICE_READY")
[Console]::Out.Flush()

# Keep event loop alive until stopped by Node backend
while ($true) {
    Start-Sleep -Milliseconds 250
}
