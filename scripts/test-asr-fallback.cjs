// Local-model backup: a failing local transcription retries through Doubao
// when (and only when) cloud credentials exist, and the result is disclosed.
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { gzipSync } = require('node:zlib');
const AsrManager = require('../src/helpers/asrManager');
const DoubaoAsr = require('../src/helpers/doubaoAsr');

function makeWav(seconds = 1) {
  const samples = 16000 * seconds;
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write('RIFF', 0, 'ascii'); buffer.writeUInt32LE(36 + samples * 2, 4); buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii'); buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22); buffer.writeUInt32LE(16000, 24); buffer.writeUInt32LE(32000, 28);
  buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36, 'ascii'); buffer.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) buffer.writeInt16LE((i % 100) * 100 - 5000, 44 + i * 2);
  return buffer;
}

function harness({ localResult, doubaoConfigured = true, cloudError = null } = {}) {
  const settings = new Map([['asr_provider', 'local'],
    ...(doubaoConfigured ? [['doubao_app_key', 'app'], ['doubao_api_key', 'key'], ['doubao_resource_id', 'res']] : [])]);
  const database = { getSetting: (key, def) => (settings.has(key) ? settings.get(key) : def) };
  const local = { transcribeAudio: async () => localResult };
  let askedPcm = null;
  const cloud = { transcribeBuffer: async pcm => { askedPcm = pcm; if (cloudError) throw cloudError; return { success: true, text: '备用识别结果', language: 'zh' }; } };
  const logs = [];
  const manager = new AsrManager({ warn: (...args) => logs.push(args) }, database, { local, cloud });
  return { manager, logs, asked: () => askedPcm };
}

(async () => {
  let h, result;
  // Local success passes through untouched.
  h = harness({ localResult: { success: true, text: '本地识别结果' }, doubaoConfigured: false });
  result = await h.manager.transcribeAudio(makeWav());
  assert.equal(result.text, '本地识别结果');
  assert.equal(result.fallback, undefined);

  // Local failure without Doubao keys keeps the local error.
  h = harness({ localResult: { success: false, error: '模型未就绪' }, doubaoConfigured: false });
  result = await h.manager.transcribeAudio(makeWav());
  assert.deepEqual(result, { success: false, error: '模型未就绪' });

  // Local failure with Doubao keys retries via the cloud and discloses it.
  h = harness({ localResult: { success: false, error: '模型未就绪' } });
  result = await h.manager.transcribeAudio(makeWav(2));
  assert.equal(result.success, true);
  assert.equal(result.text, '备用识别结果');
  assert.equal(result.fallback, true);
  assert.equal(h.asked().length, 32000 * 2, 'WAV header stripped, full PCM forwarded');

  // A throwing local manager still reaches the backup.
  h = harness({ localResult: null, doubaoConfigured: true });
  h.manager.local.transcribeAudio = async () => { throw new Error('本地崩溃'); };
  result = await h.manager.transcribeAudio(makeWav());
  assert.equal(result.fallback, true);

  // Both providers failing surfaces the local error, never a thrown one.
  h = harness({ localResult: { success: false, error: '模型未就绪' }, cloudError: new Error('网络') });
  result = await h.manager.transcribeAudio(makeWav());
  assert.deepEqual(result, { success: false, error: '模型未就绪' });
  assert.equal(h.logs.length, 1);

  // A non-16k-mono WAV aborts the backup instead of sending wrong audio.
  const wrongWav = makeWav(); wrongWav.writeUInt16LE(2, 22); // stereo
  h = harness({ localResult: { success: false, error: '模型未就绪' } });
  result = await h.manager.transcribeAudio(wrongWav);
  assert.deepEqual(result, { success: false, error: '模型未就绪' });
  assert.equal(h.asked(), null);

  // transcribeBuffer feeds a whole recording through one streaming session.
  class FakeSocket extends EventEmitter {
    static last = null;
    constructor() { super(); FakeSocket.last = this; this.sent = []; this.readyState = 0; }
    send(packet, options, callback) { this.sent.push(Buffer.from(packet)); queueMicrotask(() => callback()); }
  }
  function finalResponse(text) {
    const body = gzipSync(Buffer.from(JSON.stringify({ code: 0, result: [{ text }] })));
    const header = Buffer.from([0x11, (9 << 4) | 3, 0x11, 0]);
    const extra = Buffer.alloc(8); extra.writeInt32BE(-1, 0); extra.writeUInt32BE(body.length, 4);
    return Buffer.concat([header, extra, body]);
  }
  const client = new DoubaoAsr({ getConfig: () => ({ appKey: 'a', apiKey: 'b', resourceId: 'c' }), WebSocketClass: FakeSocket, logger: null });
  const pending = client.transcribeBuffer(makeWav(3).subarray(44));
  await new Promise(resolve => setImmediate(resolve));
  FakeSocket.last.readyState = 1;
  FakeSocket.last.emit('open');
  for (let i = 0; i < 100 && !FakeSocket.last.sent.some(packet => (packet[1] & 15) === 2); i++) {
    await new Promise(resolve => setImmediate(resolve));
  }
  FakeSocket.last.emit('message', finalResponse('流式备份结果'), true);
  const out = await pending;
  assert.equal(out.success, true);
  assert.equal(out.text, '流式备份结果');
  const kinds = FakeSocket.last.sent.map(packet => [packet[1] >> 4, packet[1] & 15]);
  assert.equal(kinds[0][0], 1, 'first packet is the request');
  assert.equal(kinds.filter(([type]) => type === 2).length, 16, '15×200ms audio packets for 3s plus the final packet');
  assert.equal(Math.round(out.duration), 3, 'duration follows the fed bytes');

  console.log('PASS: local-first with disclosed Doubao backup, WAV validation, batch streaming fallback.');
})().catch(error => { console.error(error); process.exit(1); });
