// State-machine regression tests with mocked audio/IPC; no UI or microphone access.
const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('vm');
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
async function until(check) { for (let i = 0; i < 30; i++) { if (check()) return; await tick(); } throw new Error('State transition timed out'); }
function harness(options = {}) {
  const states = [], cleanups = [], calls = { transcribe: 0, paste: [], save: [], tracksStopped: 0 };
  const media = deferred(), result = deferred();
  let hotkey, now = 0;
  const stream = { getTracks: () => [{ stop() { calls.tracksStopped++; } }] };
  class AudioContext {
    sampleRate = 16000;
    async resume() {}
    async close() {}
    createAnalyser() { return {}; }
    createMediaStreamSource() { return { connect() {} }; }
    async decodeAudioData() { return { sampleRate: 16000, getChannelData: () => new Float32Array(16000) }; }
  }
  class MediaRecorder {
    state = 'inactive';
    start() { this.state = 'recording'; }
    stop() {
      this.state = 'inactive';
      queueMicrotask(() => {
        this.ondataavailable({ data: new Blob(['test']) });
        this.onstop();
      });
    }
  }
  const api = {
    async voiceUIState() {}, onHotkeyTriggered(fn) { hotkey = fn; return () => {}; },
    onToggleDictation() { return () => {}; }, onCancelVoice() { return () => {}; },
    async registerHotkey() { return { success: true }; },
    async transcribeAudio() { calls.transcribe++; return options.deferResult ? result.promise : { success: true, text: '原始内容', duration: 1 }; },
    async getSetting() { return true; }, async processText() { return { success: false }; },
    async saveTranscription(data) { calls.save.push(data); },
    async pasteText(text) { calls.paste.push(text); }, async copyText() {}, log() {}
  };
  const context = {
    useState(value) { const slot = { value }; states.push(slot); return [value, v => { slot.value = v; }]; },
    useRef: value => ({ current: value }), useCallback: fn => fn,
    useEffect: fn => { const cleanup = fn(); if (cleanup) cleanups.push(cleanup); },
    window: { electronAPI: api }, navigator: { mediaDevices: { getUserMedia: () => options.deferMedia ? media.promise : Promise.resolve(stream) } },
    AudioContext, MediaRecorder, Blob, ArrayBuffer, DataView, Float32Array, Date,
    performance: { now: () => now }, setTimeout, clearTimeout, queueMicrotask,
    module: { exports: {} }
  };
  const source = fs.readFileSync(require('path').join(__dirname, '../src/hooks/useVoiceSession.js'), 'utf8')
    .replace(/^import .*;\r?\n/gm, '').replace(/export /g, '');
  vm.runInNewContext(source + '\nmodule.exports = useVoiceSession;', context);
  const voice = context.module.exports();
  return { voice, calls, state: () => states[0].value,
    toggle: () => hotkey(), advance: () => { now += 1000; },
    media: () => media.resolve(stream), result: () => result.resolve({ success: true, text: '迟到的内容' }),
    close: () => cleanups.forEach(fn => fn()) };
}
(async () => {
  let test = harness({ deferMedia: true });
  test.toggle(); test.voice.cancel(); test.media(); await tick();
  assert.equal(test.state(), 'idle'); assert.equal(test.calls.transcribe, 0); assert.ok(test.calls.tracksStopped > 0); test.close();
  test = harness(); test.toggle(); await until(() => test.state() === 'recording');
  test.voice.cancel(); await tick(); assert.equal(test.calls.transcribe, 0); assert.equal(test.calls.paste.length, 0); test.close();
  test = harness({ deferResult: true }); test.toggle(); await until(() => test.state() === 'recording'); test.advance(); test.toggle();
  await until(() => test.calls.transcribe === 1); test.voice.cancel(); test.result(); await tick();
  assert.equal(test.calls.save.length, 0); assert.equal(test.calls.paste.length, 0); test.close();
  test = harness(); test.toggle(); test.toggle(); await until(() => test.state() === 'recording'); test.advance(); test.toggle();
  await until(() => test.state() === 'done');
  assert.deepEqual(test.calls.paste, ['原始内容']); assert.equal(test.calls.save.length, 1); assert.equal(test.calls.transcribe, 1); test.close();
  process.stdout.write('PASS: cancel during permission request, cancel recording, discard late ASR, double-start prevention, AI-failure fallback.\n');
})().catch(error => { process.stderr.write(error.stack + '\n'); process.exitCode = 1; });
