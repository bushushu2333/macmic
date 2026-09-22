// macmic modifications Copyright 2026 bushushu2333. See NOTICE and LICENSE.
const LocalAsrManager = require('./localAsrManager');
const DoubaoAsr = require('./doubaoAsr');
const { normalizeVocabulary } = require('./vocabulary');
const ASR_KEYS = new Set(['asr_provider', 'doubao_app_key', 'doubao_api_key', 'doubao_resource_id']);
const RESOURCE_ID = 'volc.seedasr.sauc.duration';

class AsrManager {
  constructor(logger, database, { local, cloud } = {}) {
    this.logger = logger;
    this.database = database;
    this.local = local || new LocalAsrManager(logger);
    this.cloud = cloud || new DoubaoAsr({ getConfig: () => this.cloudConfig(), logger });
    this.activeSession = null;
    this.streamError = null;
  }
  get provider() { return this.database.getSetting('asr_provider', 'local') === 'doubao' ? 'doubao' : 'local'; }
  cloudConfig() {
    return { appKey: this.database.getSetting('doubao_app_key', ''),
      apiKey: this.database.getSetting('doubao_api_key', ''),
      resourceId: this.database.getSetting('doubao_resource_id', RESOURCE_ID),
      hotwords: normalizeVocabulary(this.database.getSetting('speech_vocabulary', [])) };
  }
  getSettings() {
    const { appKey, apiKey, resourceId } = this.cloudConfig();
    return { provider: this.provider, appKey, resourceId, hasApiKey: !!apiKey,
      configured: !!(appKey && apiKey && resourceId) };
  }
  async saveSettings(input) {
    if (this.activeSession) throw new Error('请先结束当前听写，再切换识别服务');
    if (!input || !['local', 'doubao'].includes(input.provider)) throw new Error('请选择有效的识别服务');
    const previousProvider = this.provider;
    const current = this.cloudConfig();
    const clean = (value, max) => {
      if (typeof value !== 'string' || value.length > max || /[\r\n\x00]/.test(value)) throw new Error('语音服务配置格式不正确');
      return value.trim();
    };
    const appKey = clean(input.appKey ?? current.appKey, 256);
    const apiKey = clean(input.apiKey ?? '', 2048) || current.apiKey;
    const resourceId = clean(input.resourceId ?? current.resourceId, 256);
    if (input.provider === 'doubao' && !(appKey && apiKey && resourceId)) throw new Error('请填写豆包语音的应用 ID、访问密钥和资源 ID');
    const save = () => {
      this.database.setSetting('doubao_app_key', appKey);
      this.database.setSetting('doubao_api_key', apiKey);
      this.database.setSetting('doubao_resource_id', resourceId);
      this.database.setSetting('asr_provider', input.provider);
    };
    this.database.db.transaction(save)();
    if (this.provider === 'doubao') this.local.stopServer();
    else {
      this.cloud.close();
      const loading = previousProvider === 'doubao' ? this.local.restartServer() : this.local.initializeAtStartup();
      loading.catch(() => {});
    }
    return this.getSettings();
  }
  get serverReady() { return this.provider === 'doubao' ? this.getSettings().configured : this.local.serverReady; }
  get modelsInitialized() { return this.provider === 'doubao' ? false : this.local.modelsInitialized; }
  get initializationPromise() { return this.provider === 'doubao' ? null : this.local.initializationPromise; }
  get pythonCmd() { return this.local.pythonCmd; }
  async checkStatus() {
    if (this.provider === 'local') return { ...await this.local.checkStatus(), provider: 'local' };
    const configured = this.getSettings().configured;
    return { success: true, provider: 'doubao', installed: configured, ready: configured,
      server_ready: configured, configured, models_initialized: false, is_initializing: false,
      model: '豆包流式语音', backend: '豆包 · 云端识别', error: configured ? null : '请配置豆包语音服务' };
  }
  initializeAtStartup() { return this.provider === 'local' ? this.local.initializeAtStartup() : Promise.resolve(this.serverReady); }
  async transcribeAudio(data, options) {
    if (this.provider !== 'local') return { success: false, error: '豆包识别需要重新开始一次流式录音' };
    return this.local.transcribeAudio(data, options);
  }
  async startStream(id) {
    if (this.provider !== 'doubao' || !this.serverReady) throw new Error('请先配置并启用豆包语音');
    if (!/^[a-zA-Z0-9-]{16,64}$/.test(id || '')) throw new Error('无效的录音会话');
    if (this.activeSession && this.activeSession !== id) throw new Error('已有录音正在进行');
    this.activeSession = id; this.streamError = null;
    try { return await this.cloud.start(id); }
    catch (error) { if (this.activeSession === id) this.activeSession = null; throw error; }
  }
  sendAudio(id, pcm) {
    if (this.activeSession !== id || this.streamError) return;
    try {
      if (!(pcm instanceof ArrayBuffer) && !ArrayBuffer.isView(pcm)) throw new Error('无效的录音数据');
      if (pcm.byteLength > 64000 || pcm.byteLength % 2) throw new Error('录音数据块格式不正确');
      this.cloud.send(id, Buffer.from(pcm instanceof ArrayBuffer ? pcm : new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength)));
    } catch (error) { this.streamError = error; this.cloud.cancel(id); }
  }
  async finishStream(id) {
    if (id !== this.activeSession) throw new Error('录音已取消，请重新开始');
    try {
      if (this.streamError) throw this.streamError;
      return await this.cloud.finish(id);
    } finally { if (this.activeSession === id) { this.activeSession = null; this.streamError = null; } }
  }
  cancelStream(id) {
    this.cloud.cancel(id);
    if (this.activeSession === id) { this.activeSession = null; this.streamError = null; }
    return true;
  }
  stopServer() { this.cloud.close(); this.activeSession = null; this.local.stopServer(); }
  restartServer() { return this.provider === 'local' ? this.local.restartServer() : Promise.resolve({success: this.serverReady}); }
}
for (const name of ['checkPythonInstallation', 'checkFunASRInstallation', 'checkModelFiles', 'getDownloadProgress', 'downloadModels', 'installFunASR', 'installPython', 'findPythonExecutable']) {
  AsrManager.prototype[name] = function (...args) { return this.local[name](...args); };
}
module.exports = AsrManager;
module.exports.ASR_KEYS = ASR_KEYS;
