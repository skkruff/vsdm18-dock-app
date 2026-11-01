// Brings keys saved by earlier versions up to the current model (key editor redesign, user
// schema 2026-11-01, docs/key-editor-schema.md). Applied wherever keys are read: profiles (plugin
// and editor), the library. Pure: returns a new key, the one given is not changed.
//
//   Switch (armable)         -> Readout with state logic (logic: steps + otherwise)
//   step with hold-to-ramp   -> { tap: step, hold: repeated step, holdMs }
//   stopwatch hold-to-reset  -> { tap: start / stop, hold: [stop, reset], holdMs }
//   readout with hold-to-ramp (a dimmer) -> Rotary

const clone = o => JSON.parse(JSON.stringify(o));

function migrateKey(key) {
  if (!key || typeof key !== 'object') return key;
  let k = clone(key);
  if (k.type === 'armable') k = fromArmable(k);
  if (k.press && !Array.isArray(k.press)) k.press = migratePress(k.press);
  if (k.type === 'readout' && k.press && k.press.hold && k.press.hold.repeatMs && k.press.hold.step !== undefined) k.type = 'rotary';
  return k;
}

// The fixed armable ladder becomes a two-step state logic: active (green), else armed (white),
// else otherwise. Faces and sublabels per step move with it.
function fromArmable(k) {
  const cond = (read, is) => ({ read, ...(is !== undefined && is !== 1 ? { is } : {}) });
  const more = list => (list || []).filter(o => o.read).map(o => cond(o.read, o.is));
  const sub = k.sublabels || {};
  const step = (when, look, name) => ({ when, look, ...(sub[name] ? { sublabel: sub[name] } : {}) });
  const out = {
    ...k,
    type: 'readout',
    logic: {
      steps: [
        step([...(k.read ? [cond(k.read, k.activeIs)] : []), ...more(k.activeOr)], 'on', 'active'),
        step([...(k.armed ? [cond(k.armed, k.armedIs)] : []), ...more(k.armedOr)], 'armed', 'armed'),
      ],
      otherwise: { look: k.otherwise || 'clear', ...(sub.otherwise ? { sublabel: sub.otherwise } : {}) },
    },
  };
  const vf = k.valueFaces || {};
  const faces = {};
  if (vf.active) faces[0] = vf.active;
  if (vf.armed) faces[1] = vf.armed;
  if (vf.otherwise) faces.otherwise = vf.otherwise;
  if (Object.keys(faces).length) out.logicFaces = faces;
  for (const f of ['armed', 'activeIs', 'armedIs', 'activeOr', 'armedOr', 'sublabels', 'valueFaces', 'otherwise']) delete out[f];
  return out;
}

const TARGET = ['input', 'var'];
const pickTarget = p => Object.fromEntries(TARGET.filter(f => p[f] !== undefined).map(f => [f, p[f]]));

function migratePress(p) {
  // Hold-to-ramp: a tap steps, holding past rampDelayMs steps by rampStep every rampMs.
  if (p.step !== undefined && p.rampMs) {
    const bounds = Object.fromEntries(['min', 'max', 'wrap'].filter(f => p[f] !== undefined).map(f => [f, p[f]]));
    const dir = Math.sign(p.step) || 1;
    return {
      tap: { step: p.step, ...bounds, ...pickTarget(p) },
      hold: { step: dir * Math.abs(p.rampStep ?? p.step), ...bounds, ...pickTarget(p), repeatMs: p.rampMs },
      holdMs: p.rampDelayMs ?? 400,
    };
  }
  // Stopwatch hold-to-reset: a tap starts / stops it, holding stops it and sets it to 0:00.
  if (p.timer !== undefined && p.holdReset) {
    return {
      tap: { timer: p.timer, action: p.action || 'toggle' },
      hold: [{ timer: p.timer, action: 'stop' }, { timer: p.timer, action: 'reset' }],
      holdMs: p.holdMs ?? 1000,
    };
  }
  return p;
}

function migrateProfile(p) {
  if (!p || !Array.isArray(p.pages)) return p;
  return { ...p, pages: p.pages.map(pg => ({ ...pg, keys: Object.fromEntries(Object.entries(pg.keys || {}).map(([s, k]) => [s, migrateKey(k)])) })) };
}

module.exports = { migrateKey, migrateProfile };
