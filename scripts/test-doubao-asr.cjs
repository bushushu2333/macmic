// No network, microphone, real credentials, or private vocabulary is used.
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { gzipSync, gunzipSync } = require('node:zlib');
const DoubaoAsr = require('../src/helpers/doubaoAsr');
const { decodePacket, encodePacket, constants } = DoubaoAsr;
const tick = () => new Promise(resolve => setImmediate(resolve));
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function response(value, { flags = 0, sequence = 1, gzip = true, type = 9, providerCode = 45000001 } = {}) {
  const raw = Buffer.from(JSON.stringify(value));
  const body = gzip ? gzipSync(raw) : raw;
  const header = Buffer.from([0x11, (type << 4) | flags, 0x10 | Number(gzip), 0]);
  const extra = Buffer.alloc(type === 15 || (flags & 1) ? 8 : 4);
  let offset = 0;
  if (type === 15) { extra.writeUInt32BE(providerCode); offset = 4; }
  else if (flags & 1) { extra.writeInt32BE(sequence); offset = 4; }
  extra.writeUInt32BE(body.length, offset);
  return Buffer.concat([header, extra, body]);
}

function outbound(packet) {
  assert.equal(packet[0], 0x11);
  assert.equal(packet.readUInt32BE(4), packet.length - 8);
  return { type: packet[1] >> 4, flags: packet[1] & 15, body: gunzipSync(packet.subarray(8)) };
}

class FakeSocket extends EventEmitter {
  static instances = [];
  constructor(url, options) {
    super(); this.url = url; this.options = options; this.readyState = 0;
    this.sent = []; this.callbacks = []; this.autoAck = true;
    FakeSocket.instances.push(this);
  }
  open() { this.readyState = 1; this.emit('open'); }
  send(packet, options, callback) {
    assert.deepEqual(options, { binary: true });
    this.sent.push(Buffer.from(packet));
    if (this.autoAck) queueMicrotask(() => callback());
    else this.callbacks.push(callback);
  }
  ack(error) { this.callbacks.shift()?.(error); }
  receive(packet) { this.emit('message', packet, true); }
  close() { this.readyState = 3; this.emit('close', 1000); }
  terminate() { this.terminated = true; this.readyState = 3; this.emit('close', 1006); }
}

const config = { apiKey: 'test-access-value', appKey: 'test-app-value',
  resourceId: 'test-resource', hotwords: ['示例词', '示例词', '', '第二个示例'] };
function harness(options = {}) {
  const logs = [];
  const client = new DoubaoAsr({ getConfig: () => config, WebSocketClass: FakeSocket,
    logger: { warn: (...args) => logs.push(args) }, ...options });
  return { client, logs };
}
async function opened(client, id = 'test') {
  const ready = client.start(id);
  await tick();
  const socket = FakeSocket.instances.at(-1);
  socket.open(); await ready;
  return socket;
}

async function main() {
  // Protocol bounds, both compression types and negative-sequence termination.
  for (const gzip of [false, true]) {
    const packet = response({ result: { text: '示例内容' } }, { gzip, flags: 3, sequence: -12 });
    assert.equal(decodePacket(packet).value.result.text, '示例内容');
    assert.equal(decodePacket(packet).sequence, -12);
    assert.equal(decodePacket(packet).final, true);
    for (let size = 0; size < packet.length; size++) {
      assert.throws(() => decodePacket(packet.subarray(0, size)), error => error.code === 'PROTOCOL');
    }
    assert.throws(() => decodePacket(Buffer.concat([packet, Buffer.from([0])])), { code: 'PROTOCOL' });
  }
  assert.equal(decodePacket(response({}, { flags: 1, sequence: -2 })).final, true);
  assert.equal(decodePacket(response({}, { flags: 2 })).final, true);
  assert.equal(decodePacket(response({ message: 'untrusted-secret-echo' }, { type: 15 })).providerCode, 45000001);
  const brokenGzip = response({}); brokenGzip.fill(0, 8);
  assert.throws(() => decodePacket(brokenGzip), { code: 'PROTOCOL' });
  const wrongType = response({}); wrongType[1] = 0xb0;
  assert.throws(() => decodePacket(wrongType), { code: 'PROTOCOL' });
  const wrongVersion = response({}); wrongVersion[0] = 0x21;
  assert.throws(() => decodePacket(wrongVersion), { code: 'PROTOCOL' });
  assert.deepEqual(outbound(encodePacket(2, 2, Buffer.alloc(0))).body, Buffer.alloc(0));

  // Audio arriving during connect remains in order behind the full request.
  let test = harness();
  const started = test.client.start('early-audio');
  const audio = Buffer.alloc(constants.CHUNK_BYTES * 2 + 300);
  for (let index = 0; index < audio.length; index++) audio[index] = index % 251;
  test.client.send('early-audio', audio.subarray(0, 3200));
  test.client.send('early-audio', audio.subarray(3200, 9000));
  test.client.send('early-audio', audio.subarray(9000));
  const finished = test.client.finish('early-audio');
  await tick();
  let socket = FakeSocket.instances.at(-1);
  socket.open(); await started; await tick();
  assert.equal(socket.url, constants.ENDPOINT);
  assert.equal(socket.options.followRedirects, false);
  const frames = socket.sent.map(outbound);
  assert.deepEqual(frames.map(frame => frame.type), [1, 2, 2, 2]);
  assert.deepEqual(frames.map(frame => frame.flags), [0, 0, 0, 2]);
  assert.deepEqual(Buffer.concat(frames.slice(1).map(frame => frame.body)), audio);
  const full = JSON.parse(frames[0].body);
  assert.equal(full.request.enable_nonstream, true);
  assert.deepEqual(full.audio, { format: 'pcm', rate: 16000, bits: 16, channel: 1 });
  assert.equal(JSON.parse(full.request.corpus.context).hotwords.length, 2);
  socket.receive(response({ result: { text: '临时内容' } }));
  socket.receive(response({ code: 20000000, result: [{ text: '最终内容' }] }, { flags: 3, sequence: -1 }));
  const output = await finished;
  assert.equal(output.success, true);
  assert.equal(output.text, '最终内容');
  assert.equal(output.duration, audio.length / 32000);
  assert.equal(output.language, 'zh');
  assert.ok(output.elapsed >= 0);
  assert.equal(test.client.session.pending.length, 0);
  assert.equal(test.client.session.queue.length, 0);
  socket.emit('error', new Error('secret-after-final'));
  assert.equal((await test.client.finish('early-audio')).text, '最终内容');
  assert.deepEqual(test.logs, []);

  // Exact 200ms audio gets one empty end marker, without duplicated samples.
  test = harness(); socket = await opened(test.client);
  test.client.send('test', Buffer.alloc(constants.CHUNK_BYTES, 7));
  const final = test.client.finish('test');
  assert.equal(test.client.finish('test'), final);
  await tick();
  assert.equal(outbound(socket.sent.at(-1)).flags, 2);
  assert.equal(outbound(socket.sent.at(-1)).body.length, 0);
  socket.receive(response({ result: { text: '完整句子' } }));
  socket.receive(response({}, { flags: 2 }));
  assert.equal((await final).text, '完整句子');

  // A close without a final marker never pastes a partial transcript.
  test = harness(); socket = await opened(test.client);
  test.client.send('test', Buffer.alloc(320));
  const incomplete = test.client.finish('test');
  socket.receive(response({ result: { text: '不能作为完整结果' } }));
  socket.close();
  await assert.rejects(incomplete, { code: 'CLOSED' });

  // Send callbacks apply backpressure; no audio can overtake an earlier send.
  test = harness(); socket = await opened(test.client); socket.autoAck = false;
  test.client.send('test', Buffer.alloc(constants.CHUNK_BYTES * 3));
  assert.equal(socket.sent.length, 2);
  socket.ack(); assert.equal(socket.sent.length, 3);
  socket.ack(); assert.equal(socket.sent.length, 4);
  socket.ack(new Error('secret-network-detail'));
  await assert.rejects(test.client.finish('test'), { code: 'NETWORK' });
  assert.ok(!JSON.stringify(test.logs).includes('secret-network-detail'));

  // Cancel during configuration cannot open a socket after the promise resolves.
  let resolveConfig;
  test = harness({ getConfig: () => new Promise(resolve => { resolveConfig = resolve; }) });
  const before = FakeSocket.instances.length;
  const pending = test.client.start('cancel-config');
  test.client.cancel('cancel-config'); resolveConfig(config);
  await assert.rejects(pending, { code: 'CANCELLED' }); await tick();
  assert.equal(FakeSocket.instances.length, before);

  // Superseded sessions, late events and stale cancellation cannot affect a new one.
  test = harness(); const firstSocket = await opened(test.client, 'first');
  test.client.send('first', Buffer.alloc(320));
  const firstFinal = test.client.finish('first');
  socket = await opened(test.client, 'second');
  await assert.rejects(firstFinal, { code: 'CANCELLED' });
  assert.equal(firstSocket.terminated, true);
  firstSocket.receive(response({ result: { text: '迟到的结果' } }, { flags: 2 }));
  firstSocket.emit('error', new Error('late error'));
  assert.equal(test.client.cancel('first'), false);
  test.client.send('second', Buffer.alloc(320));
  const secondFinal = test.client.finish('second'); await tick();
  socket.receive(response({ result: { text: '新的结果' } }, { flags: 2 }));
  assert.equal((await secondFinal).text, '新的结果');

  // Open, write, and final-result deadlines all release their resources.
  test = harness({ timeoutMs: { open: 8 } });
  await assert.rejects(test.client.start('timeout'), { code: 'OPEN_TIMEOUT' });
  assert.equal(FakeSocket.instances.at(-1).terminated, true);
  test = harness({ timeoutMs: { send: 8 } }); socket = await opened(test.client);
  socket.autoAck = false; test.client.send('test', Buffer.alloc(constants.CHUNK_BYTES));
  await sleep(15);
  await assert.rejects(test.client.finish('test'), { code: 'SEND_TIMEOUT' });
  socket.ack(); assert.equal(socket.terminated, true);
  test = harness({ timeoutMs: { finish: 8 } }); socket = await opened(test.client);
  test.client.send('test', Buffer.alloc(320));
  await assert.rejects(test.client.finish('test'), { code: 'FINAL_TIMEOUT' });
  assert.equal(socket.terminated, true);

  // Malformed/provider responses and handshake bodies never leak server text.
  for (const packet of [Buffer.from([0x11]), response({ message: 'secret-from-server' }, { type: 15 }),
    response({ code: 45000001, message: 'secret-from-server' })]) {
    test = harness(); socket = await opened(test.client); socket.receive(packet);
    await assert.rejects(test.client.finish('test'), error => !error.message.includes('secret-from-server'));
    assert.ok(!JSON.stringify(test.logs).includes('secret-from-server'));
  }
  test = harness(); const denied = test.client.start('denied'); await tick();
  socket = FakeSocket.instances.at(-1); let destroyed = false;
  socket.emit('unexpected-response', {}, { statusCode: 403, destroy() { destroyed = true; } });
  await assert.rejects(denied, { code: 'AUTH' }); assert.ok(destroyed);

  // Limits are based on uncompressed PCM, including queued and partial chunks.
  test = harness(); socket = await opened(test.client); socket.autoAck = false;
  assert.throws(() => test.client.send('test', Buffer.alloc(constants.MAX_QUEUED_AUDIO_BYTES + 2)), { code: 'BACKPRESSURE' });
  assert.equal(socket.terminated, true);
  test = harness(); socket = await opened(test.client);
  for (let index = 0; index < 300; index++) { test.client.send('test', Buffer.alloc(32000)); await tick(); }
  assert.throws(() => test.client.send('test', Buffer.alloc(2)), { code: 'TOO_LONG' });
  assert.equal(socket.terminated, true);
  test = harness(); socket = await opened(test.client);
  assert.throws(() => test.client.send('test', Buffer.alloc(3)), { code: 'AUDIO' });
  test = harness(); await opened(test.client);
  await assert.rejects(test.client.finish('test'), { code: 'EMPTY' });
  test = harness({ getConfig: () => ({ ...config, apiKey: 'bad\r\nheader' }) });
  await assert.rejects(test.client.start('bad-config'), { code: 'CONFIG' });
  test = harness(); await opened(test.client); test.client.stop();
  await assert.rejects(test.client.finish('test'), { code: 'CANCELLED' });

  process.stdout.write('PASS: Doubao framing, ordered PCM, final-only results, cancellation, supersession, close races, timeouts, bounds and secret-safe failures.\n');
}
main().catch(error => { process.stderr.write(error.stack + '\n'); process.exitCode = 1; });
