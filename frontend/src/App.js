import React, { useState, useEffect, useRef, useCallback } from 'react';
import './App.css';
import backgroundImage from './Images/Backgroung.png';
import AudioBlob from './AudioBlob';
import {
  streamGroqCompletion,
  executeOsAction,
  executeLocalIntent,
  extractActionTag,
  PRIMARY_MODEL
} from './services/groqService';
import {
  speakWithProfile,
  stopJarvisSpeech
} from './services/ttsService';

function App() {
  const [systemTime, setSystemTime] = useState(new Date().toLocaleTimeString());
  const [metrics, setMetrics] = useState({
    cpu: 28,
    memory: 4.8,
    latency: 14,
    power: 99.4
  });

  // Real-time terminal state
  const [currentPrompt, setCurrentPrompt] = useState('');
  const [liveTranscript, setLiveTranscript] = useState('');
  const [llmResponse, setLlmResponse] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isAwake, setIsAwake] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [speechError, setSpeechError] = useState(null);
  const [actionStatus, setActionStatus] = useState(null);
  const [, setMicPermissionGranted] = useState(false);

  // Stable references to prevent component re-render teardowns
  const isAwakeRef = useRef(false);
  isAwakeRef.current = isAwake;

  const isJarvisSpeakingRef = useRef(false);

  const historyRef = useRef([]);
  const isGeneratingRef = useRef(false);
  isGeneratingRef.current = isGenerating;

  const recognitionRef = useRef(null);
  const isStartedRef = useRef(false);
  const shouldListenRef = useRef(true);
  const restartTimerRef = useRef(null);
  const speakingTimeoutRef = useRef(null);
  const speechDebounceRef = useRef(null);
  const activeAbortRef = useRef(null);
  const lastDispatchedPromptRef = useRef('');
  const keepAliveStreamRef = useRef(null);
  const terminalEndRef = useRef(null);
  const wakeTimerRef = useRef(null);

  // Automatically keep voice pipeline awake for 45 seconds of natural back-and-forth dialogue
  const resetWakeTimeout = useCallback(() => {
    clearTimeout(wakeTimerRef.current);
    wakeTimerRef.current = setTimeout(() => {
      setIsAwake(false);
    }, 45000);
  }, []);

  // Centralized speech coordinator to prevent speech loop/feedback
  const speakJarvis = useCallback((text, onEnd) => {
    isJarvisSpeakingRef.current = true;
    setIsSpeaking(true);

    speakWithProfile(
      text,
      () => {
        isJarvisSpeakingRef.current = true;
        setIsSpeaking(true);
      },
      () => {
        isJarvisSpeakingRef.current = false;
        setIsSpeaking(false);
        if (onEnd) onEnd();
      }
    );
  }, []);

  const speakJarvisRef = useRef(speakJarvis);
  speakJarvisRef.current = speakJarvis;

  // Auto-scroll terminal
  useEffect(() => {
    terminalEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [llmResponse, liveTranscript, currentPrompt]);

  // Live clock
  useEffect(() => {
    const timer = setInterval(() => {
      setSystemTime(new Date().toLocaleTimeString());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Live telemetry fluctuations
  useEffect(() => {
    const interval = setInterval(() => {
      setMetrics((prev) => ({
        ...prev,
        cpu: Math.min(99, Math.max(15, Math.round(prev.cpu + (Math.random() * 6 - 3)))),
        latency: Math.min(60, Math.max(10, Math.round(prev.latency + (Math.random() * 4 - 2))))
      }));
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  // Normalize transcript text
  const cleanTranscript = (raw) => {
    return raw
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  };

  // Check if text contains wake word (including acoustic variations from low voice / whisper)
  const hasWakeWord = (cleaned) => {
    if (!cleaned) return false;
    const wakePatterns = [
      /\b(hey|hi|hello|ok|okay|yo)?\s*(jarvis|travis|service|jarves|javis|harvest|tarvis|charvis|darvis|sarvis|chalice|chavis|office|artist|darkness|java|charges|starburst|sharvis)\b/i,
      /\b(jarvis|travis|jarves|javis|harvest|tarvis|charvis|darvis|sarvis|chalice|chavis|office|artist|darkness|java|charges|starburst|sharvis)\b/i
    ];
    return wakePatterns.some((pattern) => pattern.test(cleaned));
  };

  // Extract clean directive prompt for Groq LLM
  const extractDirective = (raw) => {
    let text = raw.trim();
    // Strip wake word and whisper phonetic variations
    text = text.replace(/^(hey|hi|hello|ok|okay|yo)?\s*(jarvis|travis|service|jarves|javis|harvest|tarvis|charvis|darvis|sarvis|chalice|chavis|office|artist|darkness|java|charges|starburst|sharvis)\s*[,:]?\s*/i, '');
    text = text.replace(/^(can you\s*(please)?\s*)/i, '');
    text = text.replace(/^(could you\s*(please)?\s*)/i, '');
    text = text.replace(/^(please\s*)/i, '');
    text = text.replace(/^(i want you to\s*)/i, '');
    text = text.replace(/^(i need you to\s*)/i, '');
    text = text.replace(/^(will you\s*)/i, '');
    text = text.trim();
    return text;
  };

  // Autonomous HUD updates based on user request keywords
  const triggerHudTelemetryReaction = (text) => {
    const lower = text.toLowerCase();
    if (lower.includes('status') || lower.includes('diagnostic') || lower.includes('telemetry') || lower.includes('health')) {
      setMetrics((prev) => ({ ...prev, cpu: 54, latency: 11 }));
    } else if (lower.includes('power') || lower.includes('reactor') || lower.includes('energy')) {
      setMetrics((prev) => ({ ...prev, power: 100 }));
    } else if (lower.includes('memory') || lower.includes('buffer') || lower.includes('ram')) {
      setMetrics((prev) => ({ ...prev, memory: 3.2 }));
    } else if (lower.includes('scan') || lower.includes('radar') || lower.includes('perimeter') || lower.includes('threat')) {
      setMetrics((prev) => ({ ...prev, latency: 7 }));
    }
  };

  // Stream query to Groq LLM and display in the terminal immediately
  const dispatchGroqDirective = useCallback((userDirective) => {
    if (!userDirective || !userDirective.trim()) return;

    const trimmed = userDirective.trim();

    // Prevent re-dispatching identical prompt while already streaming
    if (trimmed.toLowerCase() === lastDispatchedPromptRef.current.toLowerCase() && isGeneratingRef.current) {
      return;
    }

    // Handle clear terminal command
    if (trimmed.toLowerCase() === 'clear' || trimmed.toLowerCase() === 'clear terminal') {
      setCurrentPrompt('');
      setLlmResponse('');
      setLiveTranscript('');
      lastDispatchedPromptRef.current = '';
      historyRef.current = [];
      return;
    }

    // Cancel any previous in-flight Groq stream
    if (activeAbortRef.current) {
      activeAbortRef.current();
      activeAbortRef.current = null;
    }

    lastDispatchedPromptRef.current = trimmed;
    setCurrentPrompt(trimmed);
    setLiveTranscript('');
    setLlmResponse('');
    setIsGenerating(true);

    triggerHudTelemetryReaction(trimmed);

    // Stream directly from Groq LPUs
    const startLlmStream = () => {
    activeAbortRef.current = streamGroqCompletion(
      trimmed,
      historyRef.current,
      (accumulatedText) => {
        // Strip out action tags while streaming for a clean visual terminal
        const display = accumulatedText
          .replace(/\[\[ACTION:.*?\]\]/gs, '')
          .replace(/\[\[ACTION:.*$/s, '')
          .trimStart();
        setLlmResponse(display);
      },
      async (finalText) => {
        setIsGenerating(false);
        activeAbortRef.current = null;

        const { cleanText, action } = extractActionTag(finalText);
        const speechContent = cleanText || finalText;
        setLlmResponse(speechContent);

        // Execute native Windows action if commanded
        if (action) {
          const actionName = (action.action || 'system').toUpperCase();
          setActionStatus(`EXECUTING // ${actionName}`);
          const result = await executeOsAction(action);
          console.log('[J.A.R.V.I.S. OS Action Result]', result);
          setActionStatus(result.success ? `SUCCESS // ${actionName}` : `FAILED // ${actionName}`);
          setTimeout(() => setActionStatus(null), 5000);
        }

        // Speak the response out loud in the dedicated cloned voice
        speakJarvisRef.current(speechContent);

        // Save into conversational history ref
        historyRef.current = [
          ...historyRef.current.slice(-6),
          { role: 'user', content: trimmed },
          { role: 'assistant', content: speechContent }
        ];
      },
      (error) => {
        setIsGenerating(false);
        activeAbortRef.current = null;
        setLlmResponse(`[COMMUNICATION ERROR: ${error.message || 'Groq connection interrupted'}]`);
      }
    );
    };

    // 1) Local intent parser first: "open spotify", "search youtube for ..." run
    //    instantly through the backend app registry. 2) Otherwise fall back to the LLM.
    executeLocalIntent(trimmed).then((local) => {
      if (lastDispatchedPromptRef.current !== trimmed) return; // superseded by a newer command

      if (local && local.handled) {
        const reply = local.message || "Done, Ma'am.";
        const actionName = (local.intent?.intent || 'open_app').toUpperCase();
        setIsGenerating(false);
        setLlmResponse(reply);
        setActionStatus(local.result?.success ? `SUCCESS // ${actionName}` : `FAILED // ${actionName}`);
        setTimeout(() => setActionStatus(null), 5000);
        speakJarvisRef.current(reply);
        historyRef.current = [
          ...historyRef.current.slice(-6),
          { role: 'user', content: trimmed },
          { role: 'assistant', content: reply }
        ];
        return;
      }

      startLlmStream();
    });
  }, []);

  // Keep ref for dispatch function to avoid callback recreation
  const dispatchGroqDirectiveRef = useRef(dispatchGroqDirective);
  dispatchGroqDirectiveRef.current = dispatchGroqDirective;

  // Real-time speech-to-text handler
  const handleSpeechStream = useCallback((rawTranscript, isFinal) => {
    if (!rawTranscript || !rawTranscript.trim()) return;

    const cleaned = cleanTranscript(rawTranscript);
    const wakeFound = hasWakeWord(cleaned);
    const directive = extractDirective(rawTranscript);

    // Keep conversational pipeline awake on wake word OR while in continuous conversation
    if (wakeFound || isAwakeRef.current) {
      if (!isAwakeRef.current) {
        setIsAwake(true);
      }
      if (resetWakeTimeout) resetWakeTimeout();
    }

    // If user said "Hey JARVIS" alone without a directive
    if (wakeFound && !directive) {
      clearTimeout(speechDebounceRef.current);
      if (isFinal) {
        setLiveTranscript('');
        setCurrentPrompt('Hey JARVIS');
        const greeting = "Online and listening, Ma'am. All Mark-VII tactical subroutines engaged. What is your directive, Sara?";
        setLlmResponse(greeting);
        setIsGenerating(false);
        speakJarvisRef.current(greeting);
      } else {
        setLiveTranscript('Hey JARVIS');
      }
      return;
    }

    // If a directive is present
    const activeText = directive || rawTranscript;

    // Show live transcript as user is speaking
    if (!isFinal) {
      setLiveTranscript(activeText);
    }

    clearTimeout(speechDebounceRef.current);

    if (isFinal && activeText) {
      setLiveTranscript('');
      dispatchGroqDirectiveRef.current(activeText);
    } else if (activeText) {
      // Adaptive 750ms natural pause for whispered/soft voice
      speechDebounceRef.current = setTimeout(() => {
        setLiveTranscript('');
        dispatchGroqDirectiveRef.current(activeText);
      }, 750);
    }
  }, [resetWakeTimeout]);

  const handleSpeechStreamRef = useRef(handleSpeechStream);
  handleSpeechStreamRef.current = handleSpeechStream;

  // Continuous background speech recognition engine with fresh instance creation on restart
  const startSpeechRecognition = useCallback(() => {
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setSpeechError('Speech recognition not supported in this browser. Please use Google Chrome.');
      return;
    }

    if (recognitionRef.current) {
      try {
        recognitionRef.current.onstart = null;
        recognitionRef.current.onend = null;
        recognitionRef.current.onerror = null;
        recognitionRef.current.onresult = null;
        recognitionRef.current.abort();
      } catch (e) {}
      recognitionRef.current = null;
    }

    try {
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';
      recognition.maxAlternatives = 3;

      recognition.onstart = () => {
        isStartedRef.current = true;
        setIsListening(true);
        setSpeechError(null);
      };

      recognition.onsoundstart = () => {
        if (!isJarvisSpeakingRef.current) {
          setIsSpeaking(true);
        }
      };

      recognition.onsoundend = () => {
        if (!isJarvisSpeakingRef.current) {
          setIsSpeaking(false);
        }
      };

      recognition.onspeechstart = () => {
        if (!isJarvisSpeakingRef.current) {
          setIsSpeaking(true);
        }
      };

      recognition.onspeechend = () => {
        if (!isJarvisSpeakingRef.current) {
          setIsSpeaking(false);
        }
      };

      recognition.onresult = (event) => {
        let currentChunk = '';
        let isChunkFinal = false;

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          let chosenText = event.results[i][0].transcript;

          // Scan all alternatives for wake words or clearest text
          for (let a = 0; a < event.results[i].length; a++) {
            const alt = event.results[i][a].transcript;
            if (hasWakeWord(cleanTranscript(alt))) {
              chosenText = alt;
              break;
            }
          }

          currentChunk += chosenText;
          if (event.results[i].isFinal) {
            isChunkFinal = true;
          }
        }

        const rawTrimmed = currentChunk.trim();
        if (!rawTrimmed) return;

        // Filter out speaker loopback
        if (isJarvisSpeakingRef.current) {
          const lower = rawTrimmed.toLowerCase();
          const isInterruption =
            lower.includes('stop') ||
            lower.includes('quiet') ||
            lower.includes('silence') ||
            lower.includes('shut up') ||
            lower.includes('wait') ||
            lower.includes('hey jarvis');

          if (isInterruption) {
            stopJarvisSpeech();
            isJarvisSpeakingRef.current = false;
            setIsSpeaking(false);
            if (lower.includes('hey jarvis')) {
              handleSpeechStreamRef.current(rawTrimmed, isChunkFinal);
            }
          }
          return;
        }

        setIsSpeaking(true);
        clearTimeout(speakingTimeoutRef.current);
        speakingTimeoutRef.current = setTimeout(() => {
          if (!isJarvisSpeakingRef.current) {
            setIsSpeaking(false);
          }
        }, 800);

        handleSpeechStreamRef.current(rawTrimmed, isChunkFinal);
      };

      recognition.onerror = (event) => {
        console.warn('Speech Engine event:', event.error);
        if (event.error === 'not-allowed') {
          setIsListening(false);
          isStartedRef.current = false;
          setSpeechError('Microphone blocked by Chrome. Click anywhere on the page, then allow the mic in the address bar.');
        }
      };

      recognition.onend = () => {
        isStartedRef.current = false;
        setIsListening(false);

        if (shouldListenRef.current) {
          clearTimeout(restartTimerRef.current);
          restartTimerRef.current = setTimeout(() => {
            if (shouldListenRef.current && !isStartedRef.current) {
              startSpeechRecognition();
            }
          }, 350);
        }
      };

      recognition.start();
      recognitionRef.current = recognition;
    } catch (err) {
      console.warn('Recognition start caught:', err);
    }
  }, []);

  // Explicitly prompt for mic permission via getUserMedia and keep the mic stream open
  // so Chrome never suspends J.A.R.V.I.S. while minimized or behind other apps.
  const requestMicAndStart = useCallback(async () => {
    try {
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        if (!keepAliveStreamRef.current) {
          keepAliveStreamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });
        }
        setMicPermissionGranted(true);
        setSpeechError(null);
      }
    } catch (err) {
      console.warn('Mic access request:', err);
      setSpeechError('Microphone permission blocked. Please click the camera/mic icon in Chrome address bar to Allow.');
    }

    shouldListenRef.current = true;
    startSpeechRecognition();
  }, [startSpeechRecognition]);

  // Start listening on mount & keep working in the background until Sara closes the window
  useEffect(() => {
    shouldListenRef.current = true;
    requestMicAndStart();

    const handleFirstGesture = () => {
      if (!isStartedRef.current) {
        requestMicAndStart();
      }
    };

    // Background watchdog: auto-revive speech recognition if Chrome ever drops it while minimized
    const watchdog = setInterval(() => {
      if (shouldListenRef.current && !isStartedRef.current) {
        startSpeechRecognition();
      }
    }, 3000);

    const handleVisibilityChange = () => {
      if (shouldListenRef.current && !isStartedRef.current) {
        startSpeechRecognition();
      }
    };

    // Desktop app lifecycle (?desktop=1): stays running in background until window is closed
    const isDesktopApp = new URLSearchParams(window.location.search).get('desktop') === '1';
    let pingInterval = null;
    const handleBeforeUnload = () => {
      if (isDesktopApp && navigator.sendBeacon) {
        navigator.sendBeacon('http://localhost:3001/api/shutdown');
      }
    };

    if (isDesktopApp) {
      fetch('http://localhost:3001/api/ping', { method: 'POST' }).catch(() => {});
      pingInterval = setInterval(() => {
        fetch('http://localhost:3001/api/ping', { method: 'POST' }).catch(() => {});
      }, 4000);
      window.addEventListener('beforeunload', handleBeforeUnload);
    }

    window.addEventListener('click', handleFirstGesture);
    window.addEventListener('touchstart', handleFirstGesture);
    window.addEventListener('keydown', handleFirstGesture);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      shouldListenRef.current = false;
      clearInterval(watchdog);
      if (pingInterval) clearInterval(pingInterval);
      clearTimeout(restartTimerRef.current);
      clearTimeout(speechDebounceRef.current);
      if (activeAbortRef.current) activeAbortRef.current();
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch (e) {}
      }
      if (keepAliveStreamRef.current) {
        keepAliveStreamRef.current.getTracks().forEach((t) => t.stop());
        keepAliveStreamRef.current = null;
      }
      window.removeEventListener('click', handleFirstGesture);
      window.removeEventListener('touchstart', handleFirstGesture);
      window.removeEventListener('keydown', handleFirstGesture);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [startSpeechRecognition, requestMicAndStart]);

  // Click on blob also activates voice
  const handleBlobClick = async () => {
    await requestMicAndStart();
    if (!isAwake) {
      setIsAwake(true);
      setCurrentPrompt('Manual Neural Core Link');
      const greeting = "Mark-VII Neural Core engaged manually, Ma'am. Standing by for your directives, Sara.";
      setLlmResponse(greeting);
      speakJarvis(greeting);
    } else {
      speakJarvis("Standing by, Sara. What is your directive?");
    }
  };

  return (
    <div
      className="hud-background-container"
      style={{ backgroundImage: `url(${backgroundImage})` }}
    >
      <div className="hud-ambient-overlay"></div>

      {/* Header */}
      <header className="hud-header">
        <div className="hud-brand">
          <div className="reactor-pulse"></div>
          <div>
            <h1 className="hud-title">J.A.R.V.I.S</h1>
            <span className="hud-subtitle">TACTICAL HUD // GROQ LPU REAL-TIME ENGINE</span>
          </div>
        </div>

        <div className="hud-status-group">
          <div className="status-pill">
            <span className={`dot ${isAwake ? 'online' : 'standby'}`}></span>
            <span>{isAwake ? 'SYSTEM: ONLINE' : 'WAKE WORD: STANDBY'}</span>
          </div>
          <div className="time-pill">{systemTime}</div>
        </div>
      </header>

      {/* Main Content Overlay */}
      <main className="hud-main-content">
        {/* Telemetry Layout: 2 Columns */}
        <section className="telemetry-layout">
          {/* Left Column */}
          <div className="telemetry-column">
            {/* NEURAL LOAD */}
            <div className="telemetry-card">
              <span className="telemetry-label">NEURAL LOAD</span>
              <div className="telemetry-value-row">
                <span className="telemetry-value">{metrics.cpu}%</span>
                <span className="telemetry-sub">8 CORES</span>
              </div>
              <div className="telemetry-bar">
                <div className="telemetry-fill" style={{ width: `${metrics.cpu}%` }}></div>
              </div>
            </div>

            {/* MEMORY BUFFER */}
            <div className="telemetry-card">
              <span className="telemetry-label">MEMORY BUFFER</span>
              <div className="telemetry-value-row">
                <span className="telemetry-value">{metrics.memory} GB</span>
                <span className="telemetry-sub">/ 16 GB</span>
              </div>
              <div className="telemetry-bar">
                <div
                  className="telemetry-fill"
                  style={{ width: `${(metrics.memory / 16) * 100}%` }}
                ></div>
              </div>
            </div>
          </div>

          {/* Right Column */}
          <div className="telemetry-column">
            {/* CORE POWER */}
            <div className="telemetry-card">
              <span className="telemetry-label">CORE POWER</span>
              <div className="telemetry-value-row">
                <span className="telemetry-value">{metrics.power}%</span>
                <span className="telemetry-sub">ARC REACTOR</span>
              </div>
              <div className="telemetry-bar">
                <div
                  className="telemetry-fill purple"
                  style={{ width: `${metrics.power}%` }}
                ></div>
              </div>
            </div>

            {/* LINK LATENCY */}
            <div className="telemetry-card">
              <span className="telemetry-label">LINK LATENCY</span>
              <div className="telemetry-value-row">
                <span className="telemetry-value">{metrics.latency} ms</span>
                <span className="telemetry-sub">SYNCHRONIZED</span>
              </div>
              <div className="telemetry-bar">
                <div
                  className="telemetry-fill"
                  style={{ width: `${metrics.latency * 1.5}%` }}
                ></div>
              </div>
            </div>
          </div>
        </section>

        {/* Audio Reactive Blob – contracts on voice, springs back on pause */}
        <div className="blob-center-area">
          <AudioBlob wakeActive={isAwake} isSpeaking={isSpeaking || isGenerating} onBlobClick={handleBlobClick} />
        </div>

        {/* Terminal Stream: Real-Time Groq LLM Response Display */}
        <section className="hud-console-section bottom-right-corner">
          <div className="console-panel">
            <div className="console-header">
              <div className="console-title-area">
                <span className="console-tag">TERMINAL STREAM // LIVE</span>
                {isGenerating && (
                  <span className="console-groq-badge">
                    <span className="badge-pulse"></span> GROQ LPU • {PRIMARY_MODEL.split('/')[1] || 'FAST'}
                  </span>
                )}
              </div>
              <div className="console-header-actions">
                <div className="exact-voice-btn static" title="Voice Model: Custom Cloned Jarvis Active">
                  <span className="voice-btn-dot" style={{ backgroundColor: '#06b6d4' }}></span>
                  <span>J.A.R.V.I.S. // CLONED</span>
                </div>
                <div className={`console-voice-pill ${isListening ? 'active' : ''}`}>
                  <span className="voice-wave-dot"></span>
                  <span>{isAwake ? 'MIC ENGAGED' : 'WAKE WORD READY'}</span>
                </div>
              </div>
            </div>

            {/* Terminal Content Area */}
            <div className="console-logs terminal-stream-body">
              {currentPrompt || liveTranscript || llmResponse ? (
                <div className="terminal-exchange">
                  {/* User Directive */}
                  {currentPrompt && (
                    <div className="terminal-line user-directive">
                      <span className="line-prefix">▶ DIRECTIVE //</span>
                      <span className="directive-text">"{currentPrompt}"</span>
                    </div>
                  )}

                  {/* Real-time speech input preview */}
                  {liveTranscript && (
                    <div className="terminal-line live-speech-preview">
                      <span className="line-prefix live-mic">🎙️ HEARING //</span>
                      <span className="live-speech-text">{liveTranscript}</span>
                      <span className="cursor-blink">▋</span>
                    </div>
                  )}

                  {/* Native Windows Action Telemetry Line */}
                  {actionStatus && (
                    <div className="terminal-line action-status-line">
                      <span className="line-prefix action-tag">⚡ OS ACTION //</span>
                      <span className="action-status-text">{actionStatus}</span>
                    </div>
                  )}

                  {/* Real-Time Groq LLM Output */}
                  {llmResponse && (
                    <div className="terminal-line jarvis-output">
                      <span className="line-prefix jarvis-tag">◈ J.A.R.V.I.S //</span>
                      <span className="jarvis-response-text">{llmResponse}</span>
                      {isGenerating && <span className="cursor-blink">▋</span>}
                    </div>
                  )}

                  {/* Thinking indicator while awaiting first tokens */}
                  {isGenerating && !llmResponse && (
                    <div className="terminal-line thinking-state">
                      <span className="line-prefix jarvis-tag">◈ J.A.R.V.I.S //</span>
                      <span className="thinking-dots">Accessing neural subroutines...</span>
                    </div>
                  )}

                  <div ref={terminalEndRef} />
                </div>
              ) : (
                <div className="console-idle-state">
                  <span className="idle-mic-icon">🎙️</span>
                  <span>
                    {isAwake
                      ? 'Listening... Speak your directive (e.g. "Scan perimeter", "Status check")'
                      : <>Say <strong>"Hey JARVIS"</strong> to activate voice directive link</>}
                  </span>
                  {speechError && (
                    <span className="speech-error-hint">{speechError}</span>
                  )}
                </div>
              )}
            </div>

            {/* Voice Status Indicator Bar */}
            <div className="console-voice-bar">
              <div className="voice-waveform">
                <span className={`wave-bar ${isListening ? 'animate' : ''}`}></span>
                <span className={`wave-bar ${isListening ? 'animate' : ''}`}></span>
                <span className={`wave-bar ${isListening ? 'animate' : ''}`}></span>
                <span className={`wave-bar ${isListening ? 'animate' : ''}`}></span>
                <span className={`wave-bar ${isListening ? 'animate' : ''}`}></span>
              </div>
              <span className="voice-status-text">
                {isGenerating
                  ? 'PROCESSING DIRECTIVE VIA GROQ LPU'
                  : isAwake
                  ? 'MIC ACTIVE • AWAITING VOICE DIRECTIVE'
                  : 'SAY "HEY JARVIS" (OR CLICK ANYWHERE) TO ENGAGE'}
              </span>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="hud-footer">
        <span>SECURITY LEVEL: ALPHA</span>
        <span>•</span>
        <span>QUANTUM ENCRYPTION: ACTIVE</span>
        <span>•</span>
        <span>MARK-VII PROTOCOLS ENGAGED</span>
      </footer>
    </div>
  );
}

export default App;
