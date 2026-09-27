// Regressions for the peripheral adapter layer: binding normalization,
// accelerator capture, global-shortcut registration and action dispatch.
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

const { BUTTON_ACTIONS, DEFAULT_BUTTON_BINDINGS, eventToAccelerator, normalizeBindings, formatAccelerator } = require('../src/utils/accelerator.mjs');

// ---- accelerator.js pure helpers ----
assert.deepEqual(Object.keys(BUTTON_ACTIONS), ['dictation', 'cancel', 'finish', 'polish_toggle']);
assert.equal(eventToAccelerator({ code: 'F13', repeat: false, isComposing: false }), 'F13');
assert.equal(eventToAccelerator({ code: 'KeyA', metaKey: true, shiftKey: true }), 'CommandOrControl+Shift+A');
assert.equal(eventToAccelerator({ code: 'Digit5', ctrlKey: true, altKey: true }), 'Control+Alt+5');
assert.equal(eventToAccelerator({ code: 'MetaLeft' }), null, 'bare modifier is not bindable');
assert.equal(eventToAccelerator({ code: 'Escape' }), null, 'Escape stays reserved for cancel');
assert.equal(eventToAccelerator({ code: 'KeyR', repeat: true }), null, 'key repeat is ignored');
assert.equal(eventToAccelerator({ code: 'PageDown', shiftKey: true }), 'Shift+PageDown');
assert.equal(eventToAccelerator({ code: 'F25' }), null, 'out-of-range function keys are rejected');
assert.equal(eventToAccelerator(null), null);
assert.deepEqual(normalizeBindings(undefined), DEFAULT_BUTTON_BINDINGS, 'missing settings fall back to defaults');
assert.deepEqual(normalizeBindings([{ accelerator: 'F13', action: 'dictation' }, { accelerator: 'F13', action: 'cancel' }]).length, 1, 'duplicate accelerators are dropped');
assert.deepEqual(normalizeBindings([{ accelerator: 'F20', action: 'nope' }]).length, 0, 'unknown actions are dropped');
assert.deepEqual(normalizeBindings([{ accelerator: '', action: 'dictation' }, 'junk', null]).length, 0, 'malformed entries are dropped');
assert.equal(normalizeBindings([{ accelerator: 'F13', action: 'cancel' }])[0].id, 'button-1', 'ids are backfilled');
assert.equal(formatAccelerator('CommandOrControl+Shift+A', true), '⌘ + ⇧ + A');
assert.equal(formatAccelerator('F13', false), 'F13');

// ---- buttonBindings.js against a mocked globalShortcut ----
function harness(denied = []) {
  const callbacks = new Map();
  const blocked = new Set(denied);
  const globalShortcut = {
    register(key, callback) { if (blocked.has(key) || callbacks.has(key)) return false; callbacks.set(key, callback); return true; },
    unregister: key => callbacks.delete(key),
    unregisterAll: () => callbacks.clear(),
    isRegistered: key => callbacks.has(key),
  };
  const context = { require: () => ({ globalShortcut }), module: { exports: {} } };
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/helpers/buttonBindings'), 'utf8'), context);
  const manager = new context.module.exports();
  return { manager, callbacks, blocked };
}

const actions = { dictation: () => {}, cancel: () => {}, finish: () => {}, polish_toggle: () => {} };
let h = harness(['F14']);
let statuses = h.manager.apply(normalizeBindings(DEFAULT_BUTTON_BINDINGS), actions);
assert.deepEqual(statuses.map(s => s.ok), [true, false, true], 'a denied accelerator reports failure instead of throwing');
assert.equal(h.callbacks.get('F13')(), undefined, 'registration stores a callable');
assert.deepEqual({ ...h.manager.statuses.find(s => s.accelerator === 'F14') }, { accelerator: 'F14', action: 'cancel', ok: false });

let fired = { cancel: 0 };
h.manager.apply(normalizeBindings([{ id: 'b1', accelerator: 'F13', action: 'dictation' }, { id: 'b2', accelerator: 'F14', action: 'cancel' }]),
  { ...actions, cancel: () => fired.cancel++ });
assert.equal(h.callbacks.has('F14'), false, 'a failed registration must not keep a stale callback');
h.callbacks.get('F14')?.();
h.manager.suspend();
assert.equal(h.callbacks.size, 0, 'suspend frees every accelerator for key capture');
h.manager.reapply();
assert.equal(h.callbacks.has('F13'), true, 'reapply restores bindings after capture mode');
assert.deepEqual(h.manager.statuses.map(s => s.ok), [true, false], 'statuses keep reporting the OS-denied key');

h = harness();
h.manager.apply(normalizeBindings([{ id: 'b2', accelerator: 'F14', action: 'cancel' }]), { ...actions, cancel: () => fired.cancel++ });
const before = fired.cancel;
h.callbacks.get('F14')();
assert.equal(fired.cancel - before, 1, 'trigger dispatches to the bound action handler');

h.manager.stop();
assert.equal(h.callbacks.size, 0, 'stop unregisters everything');
console.log('PASS: binding normalization, capture events, denied accelerators, suspend/reapply and action dispatch.');
