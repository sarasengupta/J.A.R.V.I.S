import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';

// GLSL noise functions for 3D procedural plasma
const noiseFunctions = `
  vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 permute(vec4 x) { return mod289(((x*34.0)+1.0)*x); }
  vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

  float snoise(vec3 v) {
    const vec2  C = vec2(1.0/6.0, 1.0/3.0);
    const vec4  D = vec4(0.0, 0.5, 1.0, 2.0);
    vec3 i  = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);
    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);
    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;
    i = mod289(i);
    vec4 p = permute(permute(permute(
              i.z + vec4(0.0, i1.z, i2.z, 1.0))
            + i.y + vec4(0.0, i1.y, i2.y, 1.0))
            + i.x + vec4(0.0, i1.x, i2.x, 1.0));
    float n_ = 0.142857142857;
    vec3  ns = n_ * D.wyz - D.xzx;
    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);
    vec4 x = x_ * ns.x + ns.yyyy;
    vec4 y = y_ * ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);
    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);
    vec4 s0 = floor(b0)*2.0 + 1.0;
    vec4 s1 = floor(b1)*2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));
    vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
    vec3 p0 = vec3(a0.xy, h.x);
    vec3 p1 = vec3(a0.zw, h.y);
    vec3 p2 = vec3(a1.xy, h.z);
    vec3 p3 = vec3(a1.zw, h.w);
    vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
    p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
    vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
    m = m * m;
    return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
  }

  float fbm(vec3 p) {
    float total = 0.0;
    float amplitude = 0.5;
    float frequency = 1.0;
    for (int i = 0; i < 3; i++) {
      total += snoise(p * frequency) * amplitude;
      amplitude *= 0.5;
      frequency *= 2.0;
    }
    return total;
  }
`;

function AudioBlob({ wakeActive, isSpeaking, onBlobClick }) {
  const mountRef = useRef(null);
  const [micActive, setMicActive] = useState(false);
  const audioRef = useRef({
    context: null,
    stream: null,
    source: null,
    analyser: null,
    dataArray: null,
    active: false
  });
  const isSpeakingRef = useRef(false);
  isSpeakingRef.current = Boolean(isSpeaking);

  // Initialize Web Audio and connect to real microphone stream
  const initAudio = useCallback(async () => {
    if (audioRef.current.active) {
      if (audioRef.current.context && audioRef.current.context.state === 'suspended') {
        try {
          await audioRef.current.context.resume();
        } catch (e) {}
      }
      return;
    }

    try {
      if (!navigator.mediaDevices?.getUserMedia) return;

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: false, // Disabling aggressive noise gate prevents whisper suppression
          autoGainControl: true,  // Hardware AGC automatically amplifies soft whispers
          channelCount: 1
        },
        video: false
      });

      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;

      const ctx = new AudioCtx();
      if (ctx.state === 'suspended') {
        await ctx.resume();
      }

      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.45;

      // High-sensitivity pre-amplifier for whispered / low voice detection
      const whisperGain = ctx.createGain();
      whisperGain.gain.value = 2.6; // 260% gain boost for soft voice tracking

      source.connect(whisperGain);
      whisperGain.connect(analyser);

      // Keep pipeline active by connecting through zero-gain node to destination
      const silentGain = ctx.createGain();
      silentGain.gain.value = 0;
      analyser.connect(silentGain);
      silentGain.connect(ctx.destination);

      // Prevent V8 Garbage Collection bug in Chromium:
      window._jarvisAudioContext = ctx;
      window._jarvisAudioStream = stream;
      window._jarvisAudioSource = source;
      window._jarvisAnalyser = analyser;

      audioRef.current = {
        context: ctx,
        stream,
        source,
        analyser,
        dataArray: new Uint8Array(analyser.frequencyBinCount),
        active: true
      };
      setMicActive(true);
    } catch (err) {
      console.warn('Microphone stream access error:', err.message || err);
    }
  }, []);

  // Try auto-init immediately on mount and on user interaction
  useEffect(() => {
    initAudio();

    const handleUserInteraction = () => {
      initAudio();
      if (audioRef.current.context && audioRef.current.context.state === 'suspended') {
        audioRef.current.context.resume().catch(() => {});
      }
    };

    window.addEventListener('click', handleUserInteraction);
    window.addEventListener('pointerdown', handleUserInteraction);
    window.addEventListener('touchstart', handleUserInteraction);
    window.addEventListener('keydown', handleUserInteraction);

    return () => {
      window.removeEventListener('click', handleUserInteraction);
      window.removeEventListener('pointerdown', handleUserInteraction);
      window.removeEventListener('touchstart', handleUserInteraction);
      window.removeEventListener('keydown', handleUserInteraction);
    };
  }, [initAudio]);

  // When wakeActive changes, ensure audio is running
  useEffect(() => {
    if (wakeActive) {
      initAudio();
      if (audioRef.current.context && audioRef.current.context.state === 'suspended') {
        audioRef.current.context.resume().catch(() => {});
      }
    }
  }, [wakeActive, initAudio]);

  // Three.js Scene Setup & Render Loop
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const W = mount.clientWidth || 460;
    const H = mount.clientHeight || 460;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(75, W / H, 0.1, 100);
    camera.position.z = 2.2;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.95;
    renderer.setClearColor(0x000000, 0);
    mount.appendChild(renderer.domElement);

    const mainGroup = new THREE.Group();
    scene.add(mainGroup);

    // Outer Shell
    const shellGeo = new THREE.SphereGeometry(1.0, 64, 64);
    const shellVS = `
      varying vec3 vNormal;
      varying vec3 vViewPosition;
      void main() {
        vNormal = normalize(normalMatrix * normal);
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        vViewPosition = -mvPosition.xyz;
        gl_Position = projectionMatrix * mvPosition;
      }
    `;
    const shellFS = `
      varying vec3 vNormal;
      varying vec3 vViewPosition;
      uniform vec3 uColor;
      uniform float uOpacity;
      void main() {
        float fresnel = pow(1.0 - dot(normalize(vNormal), normalize(vViewPosition)), 2.5);
        gl_FragColor = vec4(uColor, fresnel * uOpacity);
      }
    `;

    const shellBackMat = new THREE.ShaderMaterial({
      vertexShader: shellVS,
      fragmentShader: shellFS,
      uniforms: {
        uColor: { value: new THREE.Color(0x28054a) },
        uOpacity: { value: 0.35 }
      },
      transparent: true,
      blending: THREE.AdditiveBlending,
      side: THREE.BackSide,
      depthWrite: false
    });

    const shellFrontMat = new THREE.ShaderMaterial({
      vertexShader: shellVS,
      fragmentShader: shellFS,
      uniforms: {
        uColor: { value: new THREE.Color(0xa855f7) },
        uOpacity: { value: 0.48 }
      },
      transparent: true,
      blending: THREE.AdditiveBlending,
      side: THREE.FrontSide,
      depthWrite: false
    });

    mainGroup.add(new THREE.Mesh(shellGeo, shellBackMat));
    const frontShellMesh = new THREE.Mesh(shellGeo, shellFrontMat);
    mainGroup.add(frontShellMesh);

    // Inner Plasma Sphere with GLSL Shader
    const plasmaGeo = new THREE.SphereGeometry(0.998, 128, 128);
    const plasmaMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uScale: { value: 0.2 },
        uBrightness: { value: 1.35 },
        uThreshold: { value: 0.09 },
        uColorDeep: { value: new THREE.Color(0x19032e) },
        uColorMid: { value: new THREE.Color(0x8b5cf6) },
        uColorBright: { value: new THREE.Color(0xf0abfc) }
      },
      vertexShader: `
        varying vec3 vPosition;
        varying vec3 vNormal;
        varying vec3 vViewPosition;
        void main() {
          vPosition = position;
          vNormal = normalize(normalMatrix * normal);
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          vViewPosition = -mvPosition.xyz;
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform float uScale;
        uniform float uBrightness;
        uniform float uThreshold;
        uniform vec3 uColorDeep;
        uniform vec3 uColorMid;
        uniform vec3 uColorBright;
        varying vec3 vPosition;
        varying vec3 vNormal;
        varying vec3 vViewPosition;
        ${noiseFunctions}
        void main() {
          vec3 p = vPosition * uScale;
          vec3 q = vec3(
            fbm(p + vec3(0.0, uTime * 0.05, 0.0)),
            fbm(p + vec3(5.2, 1.3, 2.8) + uTime * 0.05),
            fbm(p + vec3(2.2, 8.4, 0.5) - uTime * 0.02)
          );
          float density = fbm(p + 2.0 * q);
          float t = (density + 0.4) * 0.8;
          float alpha = smoothstep(uThreshold, 0.7, t);
          vec3 cWhite = vec3(1.0);
          vec3 color = mix(uColorDeep, uColorMid, smoothstep(uThreshold, 0.5, t));
          color = mix(color, uColorBright, smoothstep(0.5, 0.8, t));
          color = mix(color, cWhite, smoothstep(0.8, 1.0, t));
          float facing = dot(normalize(vNormal), normalize(vViewPosition));
          float depthFactor = (facing + 1.0) * 0.5;
          float finalAlpha = alpha * (0.02 + 0.98 * depthFactor);
          gl_FragColor = vec4(color * uBrightness, finalAlpha);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    const plasmaMesh = new THREE.Mesh(plasmaGeo, plasmaMat);
    mainGroup.add(plasmaMesh);

    // Floating Stardust Particles
    const pCount = 600;
    const pPos = new Float32Array(pCount * 3);
    const pSizes = new Float32Array(pCount);
    for (let i = 0; i < pCount; i++) {
      const r = 0.95 * Math.cbrt(Math.random());
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      pPos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      pPos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      pPos[i * 3 + 2] = r * Math.cos(phi);
      pSizes[i] = Math.random();
    }
    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
    pGeo.setAttribute('aSize', new THREE.BufferAttribute(pSizes, 1));
    const pMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(0xf3e8ff) } },
      vertexShader: `
        uniform float uTime;
        attribute float aSize;
        varying float vAlpha;
        void main() {
          vec3 pos = position;
          pos.y += sin(uTime * 0.2 + pos.x) * 0.02;
          pos.x += cos(uTime * 0.15 + pos.z) * 0.02;
          vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          gl_PointSize = (8.0 * aSize + 4.0) * (1.0 / -mvPosition.z);
          vAlpha = 0.8 + 0.2 * sin(uTime + aSize * 10.0);
        }
      `,
      fragmentShader: `
        uniform vec3 uColor;
        varying float vAlpha;
        void main() {
          vec2 uv = gl_PointCoord - vec2(0.5);
          float dist = length(uv);
          if (dist > 0.5) discard;
          float glow = pow(1.0 - dist * 2.0, 1.8);
          gl_FragColor = vec4(uColor, glow * vAlpha);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    mainGroup.add(new THREE.Points(pGeo, pMat));

    // Animation loop
    const clock = new THREE.Clock();
    let animId;
    let smoothIntensity = 0;
    let audioTimeAccum = 0;

    const animate = () => {
      animId = requestAnimationFrame(animate);
      const t = clock.getElapsedTime();
      const audio = audioRef.current;

      let rawIntensity = 0;

      // Primary source: Web Audio Analyser
      if (audio.active && audio.analyser && audio.dataArray) {
        audio.analyser.getByteFrequencyData(audio.dataArray);

        // Vocal spectrum: focus on first 30 bins (0Hz - 4500Hz)
        let sum = 0;
        let peak = 0;
        const bins = Math.min(30, audio.dataArray.length);

        for (let i = 1; i < bins; i++) {
          const val = audio.dataArray[i];
          sum += val;
          if (val > peak) peak = val;
        }

        const avg = sum / (bins - 1);
        if (avg > 1.2 || peak > 4) {
          // Highly sensitive vocal tracking: captures whispers and low-volume voice
          rawIntensity = Math.min(1.3, (avg / 20.0) * 0.65 + (peak / 50.0) * 0.65);
        }
      }

      // Hybrid fallback: If Web Audio is quiet but speech recognition detects voice
      if (rawIntensity < 0.2 && isSpeakingRef.current) {
        rawIntensity = 0.75 + Math.sin(t * 12.0) * 0.2; // Fast speech modulation
      }

      // Quick snappy contraction on speech attack (0.50), smooth elastic expansion back (0.16)
      const attackFactor = rawIntensity > smoothIntensity ? 0.50 : 0.16;
      smoothIntensity += (rawIntensity - smoothIntensity) * attackFactor;

      // Swirl accelerates with voice
      audioTimeAccum += 0.016 * (1.0 + smoothIntensity * 3.0);

      // Plasma uniforms
      plasmaMat.uniforms.uTime.value = audioTimeAccum;
      plasmaMat.uniforms.uBrightness.value = 1.35 + smoothIntensity * 2.4; // Core burns brighter as it compresses
      plasmaMat.uniforms.uScale.value = 0.2 + smoothIntensity * 0.14;
      plasmaMat.uniforms.uThreshold.value = Math.max(0.03, 0.09 - smoothIntensity * 0.04);

      // Shell fresnel flare
      shellFrontMat.uniforms.uOpacity.value = Math.min(0.92, 0.48 + smoothIntensity * 0.45);

      // ★ SHRINK ON SPEAKING, GROW BACK ON PAUSE ★
      // Resting scale is 1.0. When speaking, contracts down to ~0.70 (-30% shrink), then bounces right back to 1.0!
      const shrinkFactor = Math.min(0.32, smoothIntensity * 0.30);
      const pulseScale = 1.0 - shrinkFactor;
      mainGroup.scale.set(pulseScale, pulseScale, pulseScale);

      // Particle system pulses
      pMat.uniforms.uTime.value = audioTimeAccum;
      plasmaMesh.rotation.y = audioTimeAccum * 0.12;
      mainGroup.rotation.x += 0.002 + smoothIntensity * 0.004;
      mainGroup.rotation.y += 0.004 + smoothIntensity * 0.006;

      renderer.render(scene, camera);
    };
    animate();

    const handleResize = () => {
      if (!mount) return;
      const curW = mount.clientWidth;
      const curH = mount.clientHeight;
      if (curW > 0 && curH > 0) {
        camera.aspect = curW / curH;
        camera.updateProjectionMatrix();
        renderer.setSize(curW, curH);
      }
    };
    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', handleResize);
      renderer.dispose();
      if (mount.contains(renderer.domElement)) {
        mount.removeChild(renderer.domElement);
      }
    };
  }, []);

  const handleClick = () => {
    initAudio();
    if (audioRef.current.context && audioRef.current.context.state === 'suspended') {
      audioRef.current.context.resume().catch(() => {});
    }
    if (onBlobClick) onBlobClick();
  };

  return (
    <div className="blob-wrapper" onClick={handleClick} title="J.A.R.V.I.S Neural Core (Click to toggle voice link)">
      <div ref={mountRef} className="blob-canvas" />
      {micActive ? (
        <div className="blob-mic-badge active">
          <span className="blob-mic-dot" />
          <span>VOICE LINK: ACTIVE</span>
        </div>
      ) : (
        <div className="blob-mic-badge pending">
          <span className="blob-mic-dot pending" />
          <span>CLICK CORE TO ENGAGE MIC</span>
        </div>
      )}
    </div>
  );
}

export default AudioBlob;
