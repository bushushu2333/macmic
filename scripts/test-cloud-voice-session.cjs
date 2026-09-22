// Cloud recording lifecycle: mocked devices/IPC; no network, mic, or credentials.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
async function until(check) { for (let i = 0; i < 40; i++) { if (check()) return; await tick(); } throw new Error('State transition timed out'); }
function harness(options = {}) {
  const states = [], cleanups = [], calls = { order: [], cancel: [], paste: [], save: [], stop: 0, close: 0, recorder: 0 };
  const media = deferred(), connect = deferred(), result = deferred();
  let hotkey, now = 0, capture, streamError;
  const stream = { getTracks: () => [{ stop() { calls.stop++; } }] };
  class AudioContext {
    sampleRate = options.sampleRate || 16000;
    destination = {};
    audioWorklet = { addModule: async name => { assert.equal(name, './pcm-capture-worklet.js'); } };
    async resume() {} async close() { calls.close++; }
    createAnalyser() { return {}; }
    createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
  }
  class AudioWorkletNode {
    port = { postMessage: ({ type }) => {
      assert.equal(type, 'flush'); calls.order.push('flush-request');
      if (!options.deferFlush) queueMicrotask(() => this.flush());
    } };
    constructor() { capture = this; }
    connect() {} disconnect() {}
    send(bytes = 6400) { this.port.onmessage({ data: { type: 'audio', buffer: new ArrayBuffer(bytes) } }); }
    flush() { this.send(200); this.port.onmessage({ data: { type: 'flushed' } }); }
  }
  const api = {
    async voiceUIState() {}, onHotkeyTriggered(fn) { hotkey = fn; return () => {}; },
    onToggleDictation() { return () => {}; }, onCancelVoice() { return () => {}; },
    onAsrStreamError(fn) { streamError = fn; return () => { streamError = null; }; },
    async registerHotkey() { return { success: true }; },
    async getAsrSettings() { return { provider: 'doubao', configured: options.configured !== false }; },
    async startAsrStream(id) { calls.order.push('start'); return options.deferConnect ? connect.promise : { success: true }; },
    sendAsrAudio(id, audio) { calls.order.push(`audio:${audio.byteLength}`); },
    async finishAsrStream() { calls.order.push('finish'); return options.deferResult ? result.promise : { success: true, text: '原始内容', duration: 1 }; },
    async cancelAsrStream(id) { calls.cancel.push(id); },
    async transcribeAudio() { throw new Error('Cloud must never use WAV transcription'); },
    async getSetting() { return true; }, async processText() { return { success: false }; },
    async saveTranscription(data) { calls.save.push(data); },
    async pasteText(text) { calls.paste.push(text); }, async copyText() {}, log() {}
  };
  const context = {
    useState(value) { const slot = { value }; states.push(slot); return [value, v => { slot.value = v; }]; },
    useRef: value => ({ current: value }), useCallback: fn => fn,
    useEffect: fn => { const cleanup = fn(); if (cleanup) cleanups.push(cleanup); },
    window: { electronAPI: api }, navigator: { mediaDevices: { getUserMedia: () => options.deferMedia ? media.promise : Promise.resolve(stream) } },
    AudioContext, AudioWorkletNode, MediaRecorder: class { constructor() { calls.recorder++; } }, Blob, ArrayBuffer, DataView, Float32Array, Date,
    crypto: { randomUUID: () => 'test-session-id' }, performance: { now: () => now }, setTimeout, clearTimeout, queueMicrotask,
    module: { exports: {} }
  };
  const source = fs.readFileSync(path.join(__dirname, '../src/hooks/useVoiceSession.js'), 'utf8').replace(/^import .*;\r?\n/gm, '').replace(/export /g, '');
  vm.runInNewContext(source + '\nmodule.exports = useVoiceSession;', context);
  const voice = context.module.exports();
  return { voice, calls, state: () => states[0].value, toggle: () => hotkey(), advance: () => { now += 1000; },
    audio: () => capture.send(), error: (id = 'test-session-id') => streamError?.({ id, error: '豆包语音连接已中断，请重新录音' }), flush: () => capture.flush(), media: () => media.resolve(stream), connect: () => connect.resolve({ success: true }),
    result: () => result.resolve({ success: true, text: '迟到内容' }), close: () => cleanups.forEach(fn => fn()) };
}
(async () => {
  let test = harness({ deferMedia: true }); test.toggle(); await tick(); test.voice.cancel(); test.media(); await tick();
  assert.equal(test.state(), 'idle'); assert.ok(test.calls.stop > 0); assert.equal(test.calls.order.length, 0); test.close();
  test = harness({ deferConnect: true }); test.toggle(); await until(() => test.calls.order.includes('start')); test.voice.cancel(); test.connect(); await tick();
  assert.equal(test.state(), 'idle'); assert.ok(test.calls.cancel.length >= 2); assert.equal(test.calls.paste.length, 0); test.close();
  test = harness(); test.toggle(); await until(() => test.state() === 'recording'); test.audio(); test.voice.cancel(); test.audio(); await tick();
  assert.deepEqual(test.calls.order, ['start', 'audio:6400']); assert.equal(test.calls.paste.length, 0); test.close();
  test = harness({ deferFlush: true }); test.toggle(); await until(() => test.state() === 'recording'); test.advance(); test.toggle(); test.voice.cancel(); test.flush(); await tick();
  assert.equal(test.state(), 'idle'); assert.ok(!test.calls.order.includes('finish')); assert.equal(test.calls.paste.length, 0); test.close();
  test = harness({ deferResult: true }); test.toggle(); await until(() => test.state() === 'recording'); test.advance(); test.toggle(); await until(() => test.calls.order.includes('finish'));
  test.voice.cancel(); test.result(); await tick(); assert.equal(test.calls.save.length, 0); assert.equal(test.calls.paste.length, 0); test.close();
  test = harness(); test.toggle(); test.toggle(); await until(() => test.state() === 'recording'); test.advance(); test.audio(); test.toggle(); test.toggle(); await until(() => test.state() === 'done');
  assert.deepEqual(test.calls.order, ['start', 'audio:6400', 'flush-request', 'audio:200', 'finish']);
  assert.equal(test.calls.save[0].file_size, 6600); assert.deepEqual(test.calls.paste, ['原始内容']); assert.equal(test.calls.recorder, 0); test.audio(); assert.equal(test.calls.order.length, 5); test.close();
  test = harness(); test.toggle(); await until(() => test.state() === 'recording'); test.toggle(); await until(() => test.state() === 'error');
  assert.ok(test.calls.cancel.length > 0); assert.ok(!test.calls.order.includes('finish')); assert.equal(test.calls.paste.length, 0); test.close();
  test = harness({ deferFlush: true }); test.toggle(); await until(() => test.state() === 'recording'); test.advance(); test.toggle(); test.close(); test.flush(); await tick();
  assert.ok(test.calls.cancel.length > 0); assert.ok(!test.calls.order.includes('finish')); assert.equal(test.calls.paste.length, 0);
  test = harness(); test.toggle(); await until(() => test.state() === 'recording'); test.error('old-session');
  assert.equal(test.state(), 'recording', 'old errors must not interrupt a newer recording');
  test.error(); assert.equal(test.state(), 'error'); assert.ok(test.calls.stop > 0); assert.ok(test.calls.cancel.length > 0); test.audio();
  assert.deepEqual(test.calls.order, ['start']); assert.equal(test.calls.paste.length, 0); test.close();
  test = harness({ deferResult: true }); test.toggle(); await until(() => test.state() === 'recording'); test.advance(); test.toggle(); await until(() => test.calls.order.includes('finish'));
  test.error(); test.result(); await tick(); assert.equal(test.state(), 'error'); assert.equal(test.calls.save.length, 0); assert.equal(test.calls.paste.length, 0); test.close();
  test = harness(); test.toggle(); await until(() => test.state() === 'recording'); test.advance(); test.toggle(); await until(() => test.state() === 'done');
  test.error(); assert.equal(test.state(), 'done', 'errors arriving after a completed session must be ignored'); test.close();
  test = harness({ sampleRate: 48000 }); test.toggle(); await until(() => test.state() === 'error'); assert.equal(test.calls.order.length, 0); test.close();
  test = harness({ configured: false }); test.toggle(); await until(() => test.state() === 'error'); assert.equal(test.calls.order.length, 0); test.close();
  process.stdout.write('PASS: cloud late-start cancellation, permission cancellation, no stale audio/results, flush ordering, sample-rate guard, no WAV/MediaRecorder, immediate stream-error cleanup, raw fallback.\n');
})().catch(error => { process.stderr.write(error.stack + '\n'); process.exitCode = 1; });
