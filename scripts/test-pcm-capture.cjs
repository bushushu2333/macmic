// Worklet packet boundaries and tail ordering without microphone access.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
let Processor;
const messages = [];
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../assets/pcm-capture-worklet.js'), 'utf8'), {
  AudioWorkletProcessor: class { port = { postMessage: value => messages.push(value) }; },
  registerProcessor: (name, type) => { assert.equal(name, 'macmic-pcm-capture'); Processor = type; },
  ArrayBuffer, DataView
});
const processor = new Processor();
for (let i = 0; i < 25; i++) processor.process([[new Float32Array(128).fill(0.5)]]);
assert.equal(messages.length, 1);
assert.equal(messages[0].buffer.byteLength, 6400);
assert.equal(new DataView(messages[0].buffer).getInt16(0, true), 16383);
processor.process([[Float32Array.from([-2, 2, 0.5]), Float32Array.from([-2, 2, -0.5])]]);
processor.port.onmessage({ data: { type: 'flush' } });
assert.deepEqual(messages.map(item => item.type), ['audio', 'audio', 'flushed']);
assert.equal(messages[1].buffer.byteLength, 6);
assert.deepEqual([...new Int16Array(messages[1].buffer)], [-32768, 32767, 0]);
assert.equal(processor.process([[new Float32Array(128).fill(1)]]), false);
processor.port.onmessage({ data: { type: 'flush' } });
assert.equal(messages.length, 3, 'nothing follows the final acknowledgement');
messages.length = 0;
const exact = new Processor();
exact.process([[new Float32Array(3200)]]);
exact.port.onmessage({ data: { type: 'flush' } });
assert.deepEqual(messages.map(item => item.type), ['audio', 'flushed'], 'no spurious empty audio packet');
process.stdout.write('PASS: PCM16 conversion, stereo mix, 200 ms boundaries, final fragment before flush, no post-flush audio.\n');
