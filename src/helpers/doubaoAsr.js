// macmic modifications Copyright 2026 bushushu2333. See NOTICE and LICENSE.
const { gzipSync, gunzipSync } = require('node:zlib');
const { randomUUID } = require('node:crypto');
const { performance } = require('node:perf_hooks');

// Volcengine's optimized bidirectional streaming protocol:
// https://www.volcengine.com/docs/6561/1354869
const ENDPOINT = 'wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async';
const BYTES_PER_SECOND = 16000 * 2;
const CHUNK_BYTES = BYTES_PER_SECOND / 5;
const MAX_AUDIO_BYTES = BYTES_PER_SECOND * 300;
const MAX_QUEUED_AUDIO_BYTES = BYTES_PER_SECOND * 10;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const MESSAGES = {
  CONFIG: '请先配置豆包语音的 App ID、Access Key 和资源 ID',
  SESSION: '这次语音输入已结束，请重新开始',
  CANCELLED: '这次语音输入已取消',
  AUDIO: '语音数据格式不正确，请重新录音',
  TOO_LONG: '单次语音输入最多支持 5 分钟',
  BACKPRESSURE: '网络上传较慢，请检查网络后重新录音',
  OPEN_TIMEOUT: '连接豆包语音超时，请检查网络后重试',
  SEND_TIMEOUT: '上传语音超时，请检查网络后重试',
  FINAL_TIMEOUT: '豆包语音识别超时，请重试',
  NETWORK: '豆包语音连接失败，请检查网络和语音服务配置',
  AUTH: '豆包语音鉴权失败，请检查 App ID、Access Key 和资源 ID',
  LIMIT: '豆包语音服务暂时不可用，请检查额度或稍后重试',
  PROTOCOL: '豆包语音返回异常，请重新录音',
  PROVIDER: '豆包语音识别失败，请检查语音服务配置后重试',
  CLOSED: '豆包语音连接已中断，请重新录音',
  EMPTY: '没有识别到语音，请重新录音',
};

function asrError(code) {
  const error = new Error(MESSAGES[code] || MESSAGES.PROVIDER);
  error.code = code;
  return error;
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  // A recording can fail before finish() is called. Preserve its rejection for
  // that caller without producing an unhandled rejection in the meantime.
  promise.catch(() => {});
  return { promise, resolve, reject };
}

function encodePacket(type, flags, payload) {
  const json = type === 1;
  const data = gzipSync(json ? Buffer.from(JSON.stringify(payload)) : payload);
  const header = Buffer.from([0x11, (type << 4) | flags, (json ? 0x10 : 0) | 1, 0]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  return Buffer.concat([header, length, data]);
}

function decodePacket(input) {
  try {
    const data = Buffer.isBuffer(input) ? input : Buffer.from(input);
    if (data.length < 8 || data.length > MAX_RESPONSE_BYTES || data[0] >> 4 !== 1) throw asrError('PROTOCOL');
    let offset = (data[0] & 15) * 4;
    const type = data[1] >> 4, flags = data[1] & 15;
    const serialization = data[2] >> 4, compression = data[2] & 15;
    if (offset < 4 || offset + 4 > data.length || ![9, 15].includes(type) || flags > 3 || compression > 1) throw asrError('PROTOCOL');
    let sequence = null, providerCode = null;
    if (type === 15) {
      providerCode = data.readUInt32BE(offset); offset += 4;
    } else if (flags & 1) {
      sequence = data.readInt32BE(offset); offset += 4;
    }
    if (offset + 4 > data.length) throw asrError('PROTOCOL');
    const length = data.readUInt32BE(offset); offset += 4;
    if (length !== data.length - offset) throw asrError('PROTOCOL');
    // Never propagate a server error body: it may echo configuration or text.
    if (type === 15) return { type, flags, sequence, final: false, providerCode };
    if (serialization !== 1) throw asrError('PROTOCOL');
    const payload = compression === 1
      ? gunzipSync(data.subarray(offset), { maxOutputLength: MAX_RESPONSE_BYTES })
      : data.subarray(offset);
    const value = payload.length ? JSON.parse(payload.toString('utf8')) : {};
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw asrError('PROTOCOL');
    return { type, flags, sequence, final: !!(flags & 2) || (sequence !== null && sequence < 0), value };
  } catch {
    throw asrError('PROTOCOL');
  }
}

function requestPayload(hotwords) {
  const request = { model_name: 'bigmodel', enable_itn: true, enable_punc: true,
    show_utterances: true, result_type: 'full', enable_nonstream: true };
  const words = [...new Set((Array.isArray(hotwords) ? hotwords : [])
    .filter(word => typeof word === 'string').map(word => word.trim())
    .filter(word => word && word.length <= 80))].slice(0, 150);
  if (words.length) request.corpus = { context: JSON.stringify({ hotwords: words.map(word => ({ word })) }) };
  return { user: { uid: 'macmic' }, audio: { format: 'pcm', rate: 16000, bits: 16, channel: 1 }, request };
}

class DoubaoAsr {
  constructor({ getConfig, logger, WebSocketClass, timeoutMs = {} }) {
    this.getConfig = getConfig;
    this.logger = logger;
    this.WebSocket = WebSocketClass;
    this.timeouts = { open: 12000, send: 12000, finish: 25000, session: 330000, ...timeoutMs };
    this.session = null;
  }

  start(sessionId) {
    if (typeof sessionId !== 'string' || !sessionId || sessionId.length > 200) return Promise.reject(asrError('SESSION'));
    if (this.session?.id === sessionId && !this.session.settled) return this.session.connected.promise;
    this.close();
    const session = { id: sessionId, connected: deferred(), result: deferred(),
      socket: null, queue: [], queuedAudioBytes: 0, pending: Buffer.alloc(0), audioBytes: 0,
      text: '', sending: false, requestSent: false, finishing: false, settled: false, timers: {} };
    this.session = session;
    this._timer(session, 'open', this.timeouts.open, 'OPEN_TIMEOUT');
    this._timer(session, 'session', this.timeouts.session, 'TOO_LONG');
    this._connect(session).catch(() => this._fail(session, 'NETWORK'));
    return session.connected.promise;
  }

  async _connect(session) {
    let config;
    try { config = await this.getConfig(); } catch { return this._fail(session, 'CONFIG'); }
    if (session.settled) return;
    const validHeader = value => typeof value === 'string' && value.trim().length > 0 && value.length < 4096 && !/[\r\n]/.test(value);
    if (!config || ![config.apiKey, config.appKey, config.resourceId].every(validHeader)) return this._fail(session, 'CONFIG');
    const WebSocket = this.WebSocket || require('ws');
    const firstPacket = encodePacket(1, 0, requestPayload(config.hotwords));
    const socket = new WebSocket(ENDPOINT, {
      headers: { 'X-Api-App-Key': config.appKey.trim(), 'X-Api-Access-Key': config.apiKey.trim(),
        'X-Api-Resource-Id': config.resourceId.trim(), 'X-Api-Connect-Id': randomUUID() },
      handshakeTimeout: this.timeouts.open, maxPayload: MAX_RESPONSE_BYTES,
      perMessageDeflate: false, followRedirects: false,
    });
    session.socket = socket;
    socket.on('open', () => {
      if (session.settled) return;
      session.queue.unshift({ packet: firstPacket, audioBytes: 0, request: true });
      this._pump(session);
    });
    socket.on('message', (data, isBinary) => {
      if (session.settled) return;
      if (isBinary === false) return this._fail(session, 'PROTOCOL');
      try {
        const response = decodePacket(data);
        if (response.type === 15) return this._fail(session, 'PROVIDER');
        if (![undefined, 0, 1000, 20000000].includes(response.value.code)) return this._fail(session, 'PROVIDER');
        let result = response.value.result;
        if (Array.isArray(result)) result = result[result.length - 1];
        if (typeof result?.text === 'string') session.text = result.text;
        if (!response.final) return;
        if (!session.finishing || !session.finalSent) return this._fail(session, 'PROTOCOL');
        const text = session.text.trim();
        if (!text) return this._fail(session, 'EMPTY');
        const output = { success: true, text, language: 'zh',
          duration: session.audioBytes / BYTES_PER_SECOND,
          elapsed: Math.max(0, (performance.now() - session.finishedAt) / 1000) };
        this._settle(session);
        session.result.resolve(output);
        this._disposeSocket(session, false);
      } catch { this._fail(session, 'PROTOCOL'); }
    });
    socket.on('unexpected-response', (_request, response) => {
      const code = response.statusCode === 401 || response.statusCode === 403 ? 'AUTH'
        : response.statusCode === 429 ? 'LIMIT' : 'NETWORK';
      this._fail(session, code);
      response.destroy();
    });
    socket.on('error', () => this._fail(session, 'NETWORK'));
    socket.on('close', () => this._fail(session, 'CLOSED'));
  }

  send(sessionId, pcm) {
    const session = this._session(sessionId);
    if (session.settled) throw session.error || asrError('SESSION');
    if (session.finishing) throw asrError('SESSION');
    if (!Buffer.isBuffer(pcm) || pcm.length % 2 !== 0) {
      this._fail(session, 'AUDIO'); throw session.error;
    }
    if (!pcm.length) return true;
    if (session.audioBytes + pcm.length > MAX_AUDIO_BYTES) {
      this._fail(session, 'TOO_LONG'); throw session.error;
    }
    if (session.queuedAudioBytes + session.pending.length + pcm.length > MAX_QUEUED_AUDIO_BYTES) {
      this._fail(session, 'BACKPRESSURE'); throw session.error;
    }
    session.audioBytes += pcm.length;
    session.pending = Buffer.concat([session.pending, pcm]);
    while (session.pending.length >= CHUNK_BYTES) {
      const chunk = session.pending.subarray(0, CHUNK_BYTES);
      session.pending = session.pending.subarray(CHUNK_BYTES);
      session.queue.push({ packet: encodePacket(2, 0, chunk), audioBytes: chunk.length });
      session.queuedAudioBytes += chunk.length;
    }
    this._pump(session);
    return true;
  }

  finish(sessionId) {
    let session;
    try { session = this._session(sessionId); } catch (error) { return Promise.reject(error); }
    if (session.settled || session.finishing) return session.result.promise;
    session.finishing = true;
    session.finishedAt = performance.now();
    if (!session.audioBytes) { this._fail(session, 'EMPTY'); return session.result.promise; }
    this._timer(session, 'finish', this.timeouts.finish, 'FINAL_TIMEOUT');
    // An empty final packet is intentional when the last 200ms chunk was
    // already sent. The flag closes the stream without duplicating audio.
    session.queue.push({ packet: encodePacket(2, 2, session.pending), audioBytes: session.pending.length, final: true });
    session.queuedAudioBytes += session.pending.length;
    session.pending = Buffer.alloc(0);
    this._pump(session);
    return session.result.promise;
  }

  cancel(sessionId) {
    if (!this.session || this.session.id !== sessionId || this.session.settled) return false;
    this._fail(this.session, 'CANCELLED');
    return true;
  }

  close() { if (this.session && !this.session.settled) this._fail(this.session, 'CANCELLED'); }
  stop() { this.close(); }

  _session(sessionId) {
    if (!this.session || this.session.id !== sessionId) throw asrError('SESSION');
    return this.session;
  }

  _timer(session, name, milliseconds, code) {
    clearTimeout(session.timers[name]);
    session.timers[name] = setTimeout(() => this._fail(session, code), milliseconds);
  }

  _pump(session) {
    if (session.settled || session.sending || session.socket?.readyState !== 1 || !session.queue.length) return;
    // Do not send queued audio before the socket's open handler has inserted
    // the full client request, even if readyState changed first.
    if (!session.requestSent && !session.queue[0].request) return;
    const item = session.queue.shift();
    session.sending = true;
    if (item.final) session.finalSent = true;
    this._timer(session, 'send', this.timeouts.send, 'SEND_TIMEOUT');
    try {
      session.socket.send(item.packet, { binary: true }, error => {
        if (session.settled) return;
        clearTimeout(session.timers.send);
        session.sending = false;
        session.queuedAudioBytes -= item.audioBytes;
        if (error) return this._fail(session, 'NETWORK');
        if (item.request) {
          session.requestSent = true;
          clearTimeout(session.timers.open);
          session.connected.resolve({ success: true });
        }
        this._pump(session);
      });
    } catch { this._fail(session, 'NETWORK'); }
  }

  _settle(session) {
    session.settled = true;
    for (const timer of Object.values(session.timers)) clearTimeout(timer);
    session.queue.length = 0;
    session.pending = Buffer.alloc(0);
    session.text = '';
  }

  _fail(session, code) {
    if (session.settled) return;
    session.error = asrError(code);
    this._settle(session);
    session.connected.reject(session.error);
    session.result.reject(session.error);
    this._disposeSocket(session, true);
    if (code !== 'CANCELLED') {
      try { this.logger?.warn('Doubao ASR session failed', { code }); } catch { /* Logging must not interrupt cleanup. */ }
    }
  }

  _disposeSocket(session, terminate) {
    const socket = session.socket;
    if (!socket) return;
    try {
      if (terminate) socket.terminate();
      else {
        socket.close();
        // A peer may never acknowledge the close handshake.
        const timer = setTimeout(() => { if (socket.readyState !== 3) socket.terminate(); }, 2000);
        timer.unref?.();
        socket.once('close', () => clearTimeout(timer));
      }
    } catch { /* The session promises have already been settled. */ }
  }
}

module.exports = DoubaoAsr;
module.exports.encodePacket = encodePacket;
module.exports.decodePacket = decodePacket;
module.exports.constants = { ENDPOINT, CHUNK_BYTES, MAX_AUDIO_BYTES, MAX_QUEUED_AUDIO_BYTES };
