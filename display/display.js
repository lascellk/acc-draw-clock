/*
 * ACC Draw Clock — display.
 *
 * Polls the Apps Script state endpoint and counts down locally from endsAt,
 * corrected by the server clock offset, so a slow or failed poll never stops
 * or jumps the clock.
 *
 * URL options:  ?url=<exec URL>   override config.js
 *               ?demo=95          run a local 95-min demo (no server); ?warn=1 sets warning minutes
 * Keys:         F = fullscreen, 1/2/3 = test start/warning/end sounds
 */
(function () {
  'use strict';

  const cfg = Object.assign({ stateUrl: '', pollMs: 5000, staleAfterMs: 30000 }, window.ACC_CONFIG || {});
  const params = new URLSearchParams(location.search);
  if (params.get('url')) cfg.stateUrl = params.get('url');
  const demo = params.has('demo');

  const $ = id => document.getElementById(id);
  const els = { label: $('label'), clock: $('clock'), sub: $('sub'), status: $('status'), gate: $('sound-gate') };

  let state = null;        // last state received
  let offsetMs = 0;        // server clock - local clock
  const samples = [];      // recent {rtt, offset}
  let lastOkAt = 0;
  let lastRunId;           // undefined until the first state is seen (no sounds on boot)
  let lastPhase = null;

  const serverNow = () => Date.now() + offsetMs;

  // ---------------------------------------------------------------- polling

  async function poll() {
    const t0 = Date.now();
    try {
      const sep = cfg.stateUrl.includes('?') ? '&' : '?';
      const res = await fetch(cfg.stateUrl + sep + 'mode=state&_=' + t0, { cache: 'no-store' });
      const t1 = Date.now();
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const s = await res.json();
      if (typeof s.serverNow === 'number') addSample(t1 - t0, s.serverNow - (t0 + t1) / 2);
      state = s;
      lastOkAt = Date.now();
    } catch (err) {
      console.warn('Poll failed:', err);
    }
    setTimeout(poll, cfg.pollMs);
  }

  // Use the offset from the quickest recent round trip — it has the least uncertainty.
  function addSample(rtt, offset) {
    samples.push({ rtt, offset });
    if (samples.length > 8) samples.shift();
    offsetMs = samples.reduce((best, s) => (s.rtt < best.rtt ? s : best)).offset;
  }

  // ---------------------------------------------------------------- view

  function view(s, now) {
    if (!s || s.status === 'idle') return { phase: 'idle' };
    const warnMs = s.warningMin * 60000;
    if (s.status === 'paused') {
      const pre = s.startDelayMsWhenPaused > 0;
      const ms = pre ? s.startDelayMsWhenPaused : s.remainingMsWhenPaused;
      return { phase: 'paused', ms, colour: pre ? 'pre' : (ms <= warnMs ? 'warn' : 'run') };
    }
    if (now < s.startsAt) return { phase: 'pre', ms: s.startsAt - now, colour: 'pre' };
    const ms = s.endsAt - now;
    if (ms <= 0) return { phase: 'over', ms: 0, overMs: -ms, colour: 'over' };
    if (ms <= warnMs) return { phase: 'warn', ms, colour: 'warn' };
    return { phase: 'run', ms, colour: 'run' };
  }

  function fmt(ms) {
    const total = Math.max(0, Math.ceil(ms / 1000));
    const m = Math.floor(total / 60), s = total % 60;
    return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  }

  function timeOfDay(ms) {
    return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  function render() {
    const now = serverNow();
    const v = view(state, now);
    let label = state && state.label ? state.label : '';
    let clock, sub = '';

    switch (v.phase) {
      case 'idle':
        label = 'Almonte Curling Club';
        clock = timeOfDay(now).replace(/\s?[AP]M$/i, '');
        break;
      case 'pre':
        clock = fmt(v.ms);
        sub = 'Starts in';
        break;
      case 'paused':
        clock = fmt(v.ms);
        sub = 'Paused';
        break;
      case 'over':
        clock = '00:00';
        sub = "Time's up · +" + fmt(v.overMs).replace(/^0/, '');
        break;
      default:
        clock = fmt(v.ms);
        sub = 'Ends ' + timeOfDay(state.endsAt);
    }

    document.body.className = v.phase === 'idle' ? 'idle'
      : v.colour + (v.phase === 'paused' ? ' paused' : '');
    setText(els.label, label);
    setText(els.sub, sub);
    if (setText(els.clock, clock)) fitClock(clock);
    setText(els.status, statusText());

    if (state) handleSounds(v, now);
  }

  function setText(el, text) {
    if (el.textContent === text) return false;
    el.textContent = text;
    return true;
  }

  // Scale the digits to fill the screen; only re-measured when the text length or window size changes.
  let fitKey = '';
  function fitClock(text) {
    const key = text.length + 'x' + innerWidth + 'x' + innerHeight;
    if (key === fitKey) return;
    fitKey = key;
    els.clock.style.fontSize = '100px';
    const scale = Math.min((innerWidth * 0.94) / els.clock.offsetWidth, (innerHeight * 0.62) / els.clock.offsetHeight);
    els.clock.style.fontSize = Math.floor(100 * scale) + 'px';
  }
  addEventListener('resize', () => { fitKey = ''; fitClock(els.clock.textContent); });

  function statusText() {
    if (demo) return 'Demo mode';
    if (!cfg.stateUrl) return 'Not configured — set stateUrl in config.js';
    if (!lastOkAt) return 'Connecting…';
    const age = Date.now() - lastOkAt;
    if (age > cfg.staleAfterMs) return '⚠ Offline — last update ' + Math.round(age / 60000) + ' min ago';
    return '';
  }

  // ---------------------------------------------------------------- sounds

  const live = p => p === 'run' || p === 'warn';

  // Sounds fire on phase changes seen by this display, so rebooting mid-draw stays quiet.
  function handleSounds(v, now) {
    const runId = state.status === 'idle' ? null : state.runId;
    const phase = v.phase;
    if (lastRunId !== undefined) {
      if (runId !== lastRunId) {
        if (runId && live(phase) && now - state.startsAt < 15000) play('start');
      } else if (phase !== lastPhase) {
        if (lastPhase === 'pre' && live(phase)) play('start');
        else if (lastPhase === 'run' && phase === 'warn') play('warning');
        else if (live(lastPhase) && phase === 'over') play('end');
      }
    }
    lastRunId = runId;
    lastPhase = phase;
  }

  // Drop start.mp3 / warning.mp3 / end.mp3 into display/sounds/ to replace the built-in tones.
  const SOUND_FILES = { start: 'sounds/start.mp3', warning: 'sounds/warning.mp3', end: 'sounds/end.mp3' };

  // [frequency Hz, start s, duration s]
  const TONES = {
    start:   [[660, 0, 0.25], [880, 0.3, 0.6]],
    warning: [[880, 0, 0.3], [880, 0.45, 0.3], [880, 0.9, 0.3]],
    end:     [[440, 0, 1.2], [440, 1.5, 2.0]],
  };

  function play(name) {
    const audio = new Audio(SOUND_FILES[name]);
    let fellBack = false;
    const fallback = () => { if (!fellBack) { fellBack = true; tone(name); } };
    audio.addEventListener('error', fallback);
    audio.play().catch(fallback);
  }

  let ctx = null;
  function audioCtx() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!ctx && AC) ctx = new AC();
    return ctx;
  }

  function tone(name) {
    const c = audioCtx();
    if (!c) return;
    const t0 = c.currentTime + 0.05;
    for (const [freq, at, dur] of TONES[name]) {
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = name === 'end' ? 'sawtooth' : 'square';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, t0 + at);
      gain.gain.linearRampToValueAtTime(0.35, t0 + at + 0.02);
      gain.gain.setValueAtTime(0.35, t0 + at + dur - 0.05);
      gain.gain.linearRampToValueAtTime(0, t0 + at + dur);
      osc.connect(gain).connect(c.destination);
      osc.start(t0 + at);
      osc.stop(t0 + at + dur + 0.05);
    }
  }

  // Browsers without the autoplay flag need one click before sound works.
  function updateSoundGate() {
    const c = audioCtx();
    els.gate.hidden = !c || c.state === 'running';
  }
  function unlockAudio() {
    const c = audioCtx();
    if (c) c.resume().then(updateSoundGate);
  }
  document.addEventListener('click', unlockAudio);

  document.addEventListener('keydown', e => {
    unlockAudio();
    const k = e.key.toLowerCase();
    if (k === 'f') {
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen().catch(() => {});
    } else if (k === '1') play('start');
    else if (k === '2') play('warning');
    else if (k === '3') play('end');
  });

  // ---------------------------------------------------------------- boot

  if (demo) {
    const minutes = parseFloat(params.get('demo')) || 95;
    const startsAt = Date.now() + 3000;
    state = {
      status: 'running', label: 'Demo — ' + minutes + ' min',
      startsAt, endsAt: startsAt + minutes * 60000,
      warningMin: params.has('warn') ? parseFloat(params.get('warn')) : 15,
      runId: 'demo', serverNow: Date.now(),
    };
  } else if (cfg.stateUrl) {
    poll();
  }

  render();
  setInterval(render, 200);
  setTimeout(updateSoundGate, 500);
})();
