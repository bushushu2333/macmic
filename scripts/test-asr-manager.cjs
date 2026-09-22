const assert = require('node:assert/strict');
const AsrManager = require('../src/helpers/asrManager');
const values = new Map();
const database = { getSetting: (key, fallback) => values.has(key) ? values.get(key) : fallback,
  setSetting: (key, value) => values.set(key, value), db: { transaction: fn => fn } };
const calls = { start: 0, stop: 0, transcribe: 0, cloud: 0, cancel: 0 };
let startResolve;
const local = { serverReady: true, modelsInitialized: true, initializationPromise: null,
  checkStatus: async () => ({server_ready:true}), initializeAtStartup: async () => { calls.start++; },
  restartServer: async () => { calls.start++; },
  stopServer: () => { calls.stop++; }, transcribeAudio: async () => { calls.transcribe++; return {success:true}; } };
const cloud = { start: () => { calls.cloud++; return new Promise(resolve => {startResolve=resolve;}); },
  send: () => {}, finish: async () => ({success:true,text:'test'}), cancel: () => { calls.cancel++; }, close: () => {} };
(async () => {
  const manager = new AsrManager({}, database, {local,cloud});
  assert.equal(manager.provider, 'local');
  await manager.initializeAtStartup(); assert.equal(calls.start,1);
  assert.equal((await manager.checkStatus()).provider,'local');
  await assert.rejects(manager.saveSettings({provider:'doubao'}));
  assert.equal(manager.provider,'local');
  await manager.saveSettings({provider:'doubao',appKey:'demo-app',apiKey:'example-only-test-key',resourceId:'demo-resource'});
  assert.equal(calls.stop,1); assert.equal(manager.serverReady,true);
  assert.equal('apiKey' in manager.getSettings(),false);
  assert.equal(JSON.stringify(manager.getSettings()).includes('example-only-test-key'),false);
  await manager.initializeAtStartup(); assert.equal(calls.start,1,'cloud must not launch local worker');
  await manager.saveSettings({provider:'doubao',apiKey:''});
  assert.equal(values.get('doubao_api_key'),'example-only-test-key');
  await assert.rejects(manager.saveSettings({provider:'doubao',appKey:'bad\r\nheader'}));
  const id='test-session-123456';
  const opening=manager.startStream(id);
  await assert.rejects(manager.saveSettings({provider:'local'}),/当前听写/);
  await assert.rejects(manager.startStream('other-session-1234'),/已有录音/);
  manager.cancelStream(id); startResolve({success:true}); await opening;
  await assert.rejects(manager.finishStream(id),/取消/);
  const again=manager.startStream('test-session-123457'); startResolve({success:true}); await again;
  manager.sendAudio('test-session-123457',new Uint8Array(3));
  await assert.rejects(manager.finishStream('test-session-123457'),/格式/);
  assert.equal(manager.activeSession,null);
  await manager.transcribeAudio(Buffer.alloc(1)); assert.equal(calls.transcribe,0,'no silent local fallback');
  await manager.saveSettings({provider:'local'}); assert.equal(calls.start,2);
  console.log('PASS: explicit provider selection, secret-free settings, preserved key, no cloud/local fallback, cancellation and config validation.');
})().catch(error=>{console.error(error);process.exitCode=1;});
