/**
 * ACC Draw Clock — Apps Script backend.
 *
 *   <exec URL>              -> control page (phone / tablet)
 *   <exec URL>?mode=state   -> JSON state for the display (read-only, open)
 *
 * Script properties (Project Settings -> Script properties), all optional:
 *   CLUB_PIN      PIN required to use the controls. Unset = controls open.
 *   WARNING_MIN   Minutes before end to switch to yellow (default 15). The warning is silent.
 *   CLEAR_AFTER_MIN  Minutes after time-up before the draw clears itself and the display
 *                 goes back to the logo (default 25; 0 = stay on "Time's up" until Stop).
 *   BLACKOUT_FROM / BLACKOUT_TO  "HH:MM" local time; the TV is black between them while no
 *                 draw is on the clock (default 23:00 to 08:00; the same time for both = off).
 *   LOG_SHEET_ID  Spreadsheet ID; every command is appended to its first sheet.
 */

// Edit this list to change the preset buttons. warningMin is optional per preset.
// End-based draws: when time runs out, teams finish the current end and play one more,
// so minutes ≈ (ends − 1.5) × ~14.6 min per end.
const PRESETS = [
  { id: 'ends8', label: '8-End Draw', minutes: 95 },
  { id: 'ends6', label: '6-End Draw', minutes: 65 },
  { id: 'md', label: 'Mixed Doubles', minutes: 90 },
];
// The control page also has a Custom button: start with presetId 'custom' and minutes 1..MAX_CUSTOM_MIN.
const MAX_CUSTOM_MIN = 240;

const DEFAULT_WARNING_MIN = 15;
const DEFAULT_CLEAR_AFTER_MIN = 25; // 95-min draw + 25 = back to the logo 2 h after the start
const MAX_DELAY_MIN = 120;
const STATE_KEY = 'STATE';
const BUZZER_KEY = 'BUZZER'; // 'off' mutes the display; anything else (incl. unset) = on

function doGet(e) {
  const params = (e && e.parameter) || {};
  if (params.mode === 'state') {
    return jsonOut_(publicState_(), params.callback);
  }
  if (params.mode === 'config') {
    return jsonOut_({ presets: PRESETS, maxCustomMin: MAX_CUSTOM_MIN, warningMin: warningDefault_(), pinRequired: Boolean(getProp_('CLUB_PIN')) }, params.callback);
  }
  const t = HtmlService.createTemplateFromFile('Control');
  t.presetsJson = JSON.stringify(PRESETS);
  t.pinRequired = Boolean(getProp_('CLUB_PIN'));
  return t.evaluate()
    .setTitle('ACC Draw Clock')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1');
}

// JSON API for the standalone control page (control/index.html). It posts {pin, cmd, arg}
// as text/plain so browsers skip the CORS preflight, which Apps Script can't answer.
// Calling this way never sends Google cookies, so phones signed in to several
// Google accounts don't hit "Sorry, unable to open the file at this time".
function doPost(e) {
  try {
    const req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (req.cmd === 'verify') {
      // PIN screen: check the PIN without changing anything.
      checkPin_(req.pin);
      return jsonOut_({ ok: true, state: publicState_() });
    }
    return jsonOut_({ ok: true, state: command(req.pin, req.cmd, req.arg) });
  } catch (err) {
    return jsonOut_({ ok: false, error: err.message || String(err) });
  }
}

// ---- Called from the control page via google.script.run ----

function getState() {
  return publicState_();
}

function command(pin, cmd, arg) {
  checkPin_(pin);
  arg = arg || {};
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const now = Date.now();
    let s = loadState_();
    switch (cmd) {
      case 'start': {
        const p = arg.presetId === 'custom' ? customPreset_(arg.minutes, arg.warningMin)
          : PRESETS.find(x => x.id === arg.presetId);
        if (!p) throw new Error('Unknown preset');
        const delayMin = Math.min(Math.max(Number(arg.delayMin) || 0, 0), MAX_DELAY_MIN);
        const startsAt = now + delayMin * 60000;
        s = {
          status: 'running',
          label: p.label,
          startsAt: startsAt,
          endsAt: startsAt + p.minutes * 60000,
          remainingMsWhenPaused: null,
          startDelayMsWhenPaused: null,
          warningMin: p.warningMin != null ? p.warningMin : warningDefault_(),
          runId: now,
        };
        break;
      }
      case 'pause':
        if (s.status !== 'running') break;
        s.status = 'paused';
        s.startDelayMsWhenPaused = Math.max(0, s.startsAt - now);
        s.remainingMsWhenPaused = Math.max(0, s.endsAt - Math.max(now, s.startsAt));
        break;
      case 'resume':
        if (s.status !== 'paused') break;
        s.status = 'running';
        s.startsAt = now + s.startDelayMsWhenPaused;
        s.endsAt = s.startsAt + s.remainingMsWhenPaused;
        s.remainingMsWhenPaused = null;
        s.startDelayMsWhenPaused = null;
        break;
      case 'adjust': {
        const delta = Math.round(Number(arg.minutes) || 0) * 60000;
        if (s.status === 'running') {
          // If time is already up, +1 gives one minute from now.
          s.endsAt = Math.max(s.startsAt, Math.max(s.endsAt, now) + delta);
        } else if (s.status === 'paused') {
          s.remainingMsWhenPaused = Math.max(0, s.remainingMsWhenPaused + delta);
        }
        break;
      }
      case 'stop':
        s = idleState_();
        break;
      case 'buzzer':
        // Kept outside the draw state so it survives Stop / new draws.
        PropertiesService.getScriptProperties().setProperty(BUZZER_KEY, arg.on ? 'on' : 'off');
        break;
      default:
        throw new Error('Unknown command: ' + cmd);
    }
    saveState_(s);
    log_(cmd, arg);
    return publicState_();
  } finally {
    lock.releaseLock();
  }
}

// ---- State ----

function idleState_() {
  return {
    status: 'idle',
    label: '',
    startsAt: null,
    endsAt: null,
    remainingMsWhenPaused: null,
    startDelayMsWhenPaused: null,
    warningMin: warningDefault_(),
    runId: null,
  };
}

function loadState_() {
  const raw = PropertiesService.getScriptProperties().getProperty(STATE_KEY);
  const s = raw ? JSON.parse(raw) : idleState_();
  // A draw left on "Time's up" clears itself after CLEAR_AFTER_MIN; the next command saves the idle state.
  const clearMin = clearAfterMin_();
  if (s.status === 'running' && clearMin > 0 && Date.now() - s.endsAt >= clearMin * 60000) {
    return idleState_();
  }
  return s;
}

function saveState_(s) {
  s.updatedAt = Date.now();
  PropertiesService.getScriptProperties().setProperty(STATE_KEY, JSON.stringify(s));
}

function publicState_() {
  const s = loadState_();
  s.buzzer = getProp_(BUZZER_KEY) !== 'off';
  s.clearAfterMin = clearAfterMin_();
  s.blackoutFrom = timeProp_('BLACKOUT_FROM', '23:00');
  s.blackoutTo = timeProp_('BLACKOUT_TO', '08:00');
  s.serverNow = Date.now();
  return s;
}

// ---- Helpers ----

function getProp_(key) {
  return PropertiesService.getScriptProperties().getProperty(key);
}

function warningDefault_() {
  const v = Number(getProp_('WARNING_MIN'));
  return v > 0 ? v : DEFAULT_WARNING_MIN;
}

// A one-off countdown of the user's length. The warning is optional: blank = a quarter of the
// time, capped at the usual warning, so a short countdown doesn't start out yellow
// (60+ min -> 15, 30 -> 7, 10 -> 2); otherwise 0 (no warning) up to one less than the countdown.
function customPreset_(minutes, warningMin) {
  const m = Number(minutes);
  if (!Number.isInteger(m) || m < 1 || m > MAX_CUSTOM_MIN) {
    throw new Error('Enter whole minutes from 1 to ' + MAX_CUSTOM_MIN);
  }
  let w = Math.min(warningDefault_(), Math.floor(m / 4));
  if (warningMin != null && warningMin !== '') {
    w = Number(warningMin);
    if (!Number.isInteger(w) || w < 0 || w >= m) {
      throw new Error('Warning must be whole minutes from 0 to ' + (m - 1));
    }
  }
  return { label: m + '-min Countdown', minutes: m, warningMin: w };
}

// "HH:MM" from a script property, or the default if it's unset or malformed.
function timeProp_(key, fallback) {
  const v = String(getProp_(key) || '').trim();
  return /^([01]?\d|2[0-3]):[0-5]\d$/.test(v) ? v : fallback;
}

function clearAfterMin_() {
  const raw = getProp_('CLEAR_AFTER_MIN');
  const v = Number(raw);
  return raw !== null && raw !== '' && v >= 0 ? v : DEFAULT_CLEAR_AFTER_MIN;
}

function checkPin_(pin) {
  const expected = getProp_('CLUB_PIN');
  if (expected && String(pin || '').trim() !== expected) {
    throw new Error('Wrong PIN');
  }
}

function jsonOut_(obj, callback) {
  // JSONP fallback in case a display browser blocks the cross-origin fetch.
  if (callback && /^[A-Za-z_$][\w$]*$/.test(callback)) {
    return ContentService.createTextOutput(callback + '(' + JSON.stringify(obj) + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function log_(cmd, arg) {
  const id = getProp_('LOG_SHEET_ID');
  if (!id) return;
  try {
    SpreadsheetApp.openById(id).getSheets()[0]
      .appendRow([new Date(), cmd, JSON.stringify(arg)]);
  } catch (err) {
    console.warn('Log failed: ' + err);
  }
}
