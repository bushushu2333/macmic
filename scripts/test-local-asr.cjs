// Integration smoke test. Supply a WAV fixture; no microphone, network, or clipboard access.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('node:assert/strict');
const { createRequire } = require('module');
const file = path.resolve(__dirname, '../src/helpers/localAsrManager.js');
const localRequire = createRequire(file);
const sandbox = { module: { exports: {} }, exports: {}, __dirname: path.dirname(file),
  require: name => name === 'electron' ? { app: { isPackaged: false } } : localRequire(name),
  process, Buffer, setTimeout, clearTimeout };
vm.runInNewContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file });
const Manager = sandbox.module.exports;
(async () => {
  const manager = new Manager({ info() {}, warn() {} });
  try {
    const first = manager.initializeAtStartup();
    assert.equal(first, manager.initializeAtStartup(), 'concurrent startup must share one promise');
    await Promise.all([first, manager.initializeAtStartup(), manager.initializeAtStartup()]);
    assert.equal((await manager.checkStatus()).server_ready, true);
    const pid = manager.serverProcess.pid;
    const audio = fs.readFileSync(process.argv[2]);
    const terms = require('../src/helpers/vocabulary').DEFAULT_VOCABULARY;
    const result = await manager.transcribeAudio(audio, { hotwords: terms });
    assert.equal(result.success, true, result.error);
    assert.ok(result.text.trim().length > 0, 'expected speech in fixture');
    assert.ok(result.duration > 1);
    assert.equal(manager.serverProcess.pid, pid);
    const invalid = await manager.transcribeAudio(Buffer.from([1, 2, 3]));
    assert.equal(invalid.success, false, 'invalid audio must not be accepted');
    assert.equal(manager.serverProcess.pid, pid, 'a failed request must not kill the worker');
    process.stdout.write(JSON.stringify({ success: true, duration: result.duration, elapsed: result.elapsed, text: result.text }) + '\n');
  } finally { manager.stopServer(); }
})().catch(error => { process.stderr.write(error.stack + '\n'); process.exitCode = 1; });
