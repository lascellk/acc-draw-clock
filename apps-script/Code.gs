/**
 * ACC Draw Clock — Apps Script backend.
 *
 *   <exec URL>              -> control page (phone / tablet)
 *   <exec URL>?mode=state   -> JSON state for the display (read-only, open)
 *
 * Script properties (Project Settings -> Script properties), all optional:
 *   CLUB_PIN      PIN required to use the controls. Unset = controls open.
 *   WARNING_MIN   Minutes before end to switch to yellow + warning sound (default 15).
 *   LOG_SHEET_ID  Spreadsheet ID; every command is appended to its first sheet.
 */

// Edit this list to change the preset buttons. warningMin is optional per preset.
// End-based draws: when time runs out, teams finish the current end and play one more,
// so minutes ≈ (ends − 1.5) × ~14.6 min per end.
const PRESETS = [
  { id: 'ends8', label: '8-End Draw', minutes: 95 },
  { id: 'ends6', label: '6-End Draw', minutes: 65 },
  { id: 'draw120', label: '2-hr Draw', minutes: 120 },
  { id: 'md', label: 'Mixed Doubles', minutes: 90 },
];

const DEFAULT_WARNING_MIN = 15;
const MAX_DELAY_MIN = 120;
const STATE_KEY = 'STATE';
const BUZZER_KEY = 'BUZZER'; // 'off' mutes the display; anything else (incl. unset) = on

function doGet(e) {
  const params = (e && e.parameter) || {};
  if (params.mode === 'state') {
    return jsonOut_(publicState_(), params.callback);
  }
  if (params.mode === 'config') {
    return jsonOut_({ presets: PRESETS, pinRequired: Boolean(getProp_('CLUB_PIN')) }, params.callback);
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
        const p = PRESETS.find(x => x.id === arg.presetId);
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
  return raw ? JSON.parse(raw) : idleState_();
}

function saveState_(s) {
  s.updatedAt = Date.now();
  PropertiesService.getScriptProperties().setProperty(STATE_KEY, JSON.stringify(s));
}

function publicState_() {
  const s = loadState_();
  s.buzzer = getProp_(BUZZER_KEY) !== 'off';
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
