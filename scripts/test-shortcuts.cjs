// Regressions: startup must keep a fallback even when the legacy bridge is taken.
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
function harness(blocked = []) {
  const callbacks = new Map();
  const denied = new Set(blocked);
  let now = 1000;
  const globalShortcut = {
    register(key, callback) { if (denied.has(key)) return false; callbacks.set(key, callback); return true; },
    unregister: key => callbacks.delete(key), unregisterAll: () => callbacks.clear(),
    isRegistered: key => callbacks.has(key),
  };
  const context = { require: () => ({ globalShortcut }), process: { platform: 'darwin' }, Date: { now: () => now }, module: { exports: {} } };
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/helpers/hotkeyManager'), 'utf8'), context);
  const manager = new context.module.exports();
  let triggers = 0; manager.dictationCallback = () => triggers++;
  return { manager, callbacks, denied, advance: ms => { now += ms; }, count: () => triggers };
}
const fallback = 'CommandOrControl+Shift+Space';
let h = harness(['F19']);
assert.equal(h.manager.registerDictation(), true);
assert.equal(h.callbacks.has(fallback), true);
h = harness(); h.manager.registerDictation();
h.manager.triggerDictation(); h.advance(80); h.callbacks.get('F19')();
assert.equal(h.count(), 1, 'native tap and its legacy F19 bridge must not start then stop');
h.advance(400); h.callbacks.get(fallback)(); assert.equal(h.count(), 2);
h.callbacks.clear(); h.manager.recover();
assert.equal(h.callbacks.has(fallback), true, 'wake must repair missing OS registration');
h.denied.add(fallback); h.manager.recover();
assert.equal(h.manager.isHotkeyRegistered(fallback), false, 'a failed repair must not claim readiness');
h.denied.clear(); h.manager.registerDictation(); assert.equal(h.manager.isHotkeyRegistered(fallback), true);
h = harness(['F19', fallback]); assert.equal(h.manager.registerDictation(), false);
console.log('PASS: fallback conflict, native/legacy deduplication, wake recovery and accurate failure status.');
