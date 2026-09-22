// Verify process ownership, readiness and recovery without touching the keyboard.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');

function harness(platform = 'win32', packaged = true) {
  let now = 1000, triggers = 0, serial = 0;
  const children = [], timers = new Map(), intervals = new Map();
  const schedule = collection => (callback, delay) => { const id = ++serial; collection.set(id, { callback, delay }); return id; };
  const context = {
    module: { exports: {} }, __dirname: path.resolve('src/helpers'),
    process: { platform, pid: 1234, resourcesPath: '/app/resources' }, Date: { now: () => now },
    setTimeout: schedule(timers), clearTimeout: id => timers.delete(id),
    setInterval: schedule(intervals), clearInterval: id => intervals.delete(id),
    require(name) {
      if (name === 'electron') return { app: { isPackaged: packaged } };
      if (name === 'node:path') return path;
      if (name === 'node:child_process') return { spawn(executable, args, options) {
        const child = new EventEmitter();
        child.stdout = new EventEmitter(); child.killed = false;
        child.kill = () => { child.killed = true; };
        child.executable = executable; child.args = [...args]; child.options = options;
        children.push(child); return child;
      } };
      if (name === 'node:readline') return { createInterface({ input }) { input.close = () => {}; return input; } };
      throw new Error(name);
    },
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/helpers/nativeShortcut'), 'utf8'), context);
  const manager = new context.module.exports(() => triggers++);
  const send = (child, data) => child.stdout.emit('line', JSON.stringify(data));
  return { manager, children, timers, intervals, send, count: () => triggers, advance: ms => { now += ms; } };
}

let h = harness();
h.manager.start(); h.manager.start();
assert.equal(h.children.length, 1);
const first = h.children[0];
assert.ok(first.executable.endsWith(path.join('native', 'macmic-hotkey.exe')));
assert.deepEqual(first.args, ['--parent-pid', '1234']);
assert.equal(first.options.windowsHide, true);
assert.equal(h.manager.isReady(), false);
h.send(first, { type: 'trigger' }); assert.equal(h.count(), 0);
h.send(first, { type: 'status', ready: true });
assert.equal(h.manager.isReady(), true);
h.send(first, { type: 'trigger' }); assert.equal(h.count(), 1);
h.advance(16000);
assert.equal(h.manager.isReady(), false, 'stale helper must not claim readiness');
h.send(first, { type: 'trigger' }); assert.equal(h.count(), 1);
h.advance(5000);
[...h.intervals.values()][0].callback();
assert.equal(first.killed, true);
assert.equal(h.children.length, 2, 'watchdog restarts stalled helper');
h.send(first, { type: 'status', ready: true });
h.send(first, { type: 'trigger' }); assert.equal(h.count(), 1, 'ignore late old-process events');
const second = h.children[1];
second.emit('error', new Error('spawn failed')); second.emit('exit', 1);
assert.equal(h.timers.size, 1, 'error and exit must schedule one retry');
h.manager.stop();
assert.equal(h.timers.size, 0);
assert.equal(h.intervals.size, 0);
h = harness('darwin', false); h.manager.start();
assert.ok(h.children[0].executable.endsWith(path.join('native', 'bin', 'macmic-hotkey')));
assert.deepEqual(h.children[0].args, []);
h = harness('linux'); h.manager.start(); assert.equal(h.children.length, 0);
console.log('PASS: native helper platform paths, parent ownership, stale status, watchdog, crash retry and shutdown.');
