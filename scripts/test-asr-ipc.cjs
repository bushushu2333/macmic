const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const handlers = new Map(), listeners = new Map();
const overlay = new EventEmitter(), panel = {};
const sent=[]; overlay.send=(...args)=>sent.push(args);
const calls=[];
const context = { module:{exports:{}}, require(name) {
  if(name==='electron') return { ipcMain:{handle:(name,fn)=>handlers.set(name,fn),on:(name,fn)=>listeners.set(name,fn)}, globalShortcut:{unregister:name=>calls.push(name)}, app:{}, systemPreferences:{}, shell:{} };
  if(name==='./asrManager') return {ASR_KEYS:new Set(['asr_provider','doubao_api_key'])};
  throw new Error('Unexpected import '+name);
}, console, process: {env:{NODE_ENV:'production'}} };
vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../src/helpers/ipcHandlers.js'),'utf8'),context);
const asr={ activeSession:null, streamError:null, getSettings:()=>({hasApiKey:true}), saveSettings:()=>({provider:'doubao'}),
 startStream:async id=>{asr.activeSession=id;return {success:true};}, finishStream:async()=>({success:true}),
 cancelStream:()=>{asr.activeSession=null;calls.push('cancel');return true;},
 sendAudio:()=>{asr.streamError=new Error('网络连接中断');} };
const ipc=new context.module.exports({databaseManager:{getAllSettings:()=>({doubao_api_key:'private-test-only',speech_vocabulary:[]}),getSetting:()=> 'private-test-only',setSetting:()=>calls.push('write')},
 windowManager:{mainWindow:{webContents:overlay,hide:()=>calls.push('hide')},controlPanelWindow:{webContents:panel}},funasrManager:asr,hotkeyManager:{setRecordingState:v=>calls.push(v)}});
(async()=>{
 assert.equal(handlers.get('get-setting')({},'doubao_api_key'),'');
 for(const name of ['get-all-settings','get-settings']) assert.equal('doubao_api_key' in handlers.get(name)({}),false);
 assert.throws(()=>handlers.get('set-setting')({},'asr_provider','doubao'));
 assert.throws(()=>handlers.get('save-asr-settings')({sender:overlay},{}));
 ipc.voiceState='recording'; assert.throws(()=>handlers.get('save-asr-settings')({sender:panel},{}));
 await assert.rejects(handlers.get('start-asr-stream')({sender:panel},'session'));
 assert.equal((await handlers.get('start-asr-stream')({sender:overlay},'session')).success,true);
 listeners.get('asr-stream-audio')({sender:panel},'session',new ArrayBuffer(2)); assert.equal(asr.streamError,null);
 listeners.get('asr-stream-audio')({sender:overlay},'session',new ArrayBuffer(2)); assert.equal(sent[0][0],'asr-stream-error');
 overlay.emit('render-process-gone'); assert.equal(ipc.voiceState,'idle'); assert.ok(calls.includes('Escape')); assert.ok(calls.includes(false)); assert.ok(calls.includes('hide'));
 console.log('PASS: ASR IPC ownership, secret redaction, explicit settings path, stream errors and renderer-crash cleanup.');
})().catch(error=>{console.error(error);process.exitCode=1;});
