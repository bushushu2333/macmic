// macmic modifications Copyright 2026 bushushu2333. Derived from yan5xu/ququ; see NOTICE and LICENSE.
const { app } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const { randomUUID } = require('crypto');
const { runtimeConfig } = require('./platform');

class LocalAsrManager {
  constructor(logger) {
    this.logger = logger;
    this.runtime = runtimeConfig();
    this.root = this.runtime.root;
    this.pythonCmd = this.runtime.python;
    this.modelPath = this.runtime.modelPath;
    this.backendLabel = this.runtime.label;
    this.serverProcess = null;
    this.serverReady = false;
    this.modelsInitialized = false;
    this.initializationPromise = null;
    this.pending = new Map();
    this.error = null;
  }
  async checkPythonInstallation() { return fs.existsSync(this.pythonCmd); }
  async checkFunASRInstallation() { return this.checkPythonInstallation(); }
  async checkModelFiles() {
    const ready = ['model.safetensors', 'model.safetensors.index.json'].some(name => fs.existsSync(path.join(this.modelPath, name)));
    return { success: ready, allModelsExist: ready, allModelsDownloaded: ready };
  }
  async checkStatus() {
    return { success: true, installed: await this.checkPythonInstallation(),
      ready: this.serverReady, server_ready: this.serverReady, models_initialized: this.modelsInitialized,
      is_initializing: !!this.initializationPromise, error: this.error,
      model: this.runtime.model, backend: this.backendLabel };
  }
  initializeAtStartup() { return this.preInitializeModels(); }
  preInitializeModels() {
    if (this.serverReady) return Promise.resolve(true);
    if (this.initializationPromise) return this.initializationPromise;
    this.initializationPromise = this.start().finally(() => { this.initializationPromise = null; });
    return this.initializationPromise;
  }
  async start() {
    this.error = null;
    if (!fs.existsSync(this.pythonCmd) || !(await this.checkModelFiles()).success) {
      this.error = '本地模型未安装。' + this.runtime.setup;
      throw new Error(this.error);
    }
    const env = { ...process.env };
    for (const key of ['PYTHONHOME', 'PYTHONPATH', 'PYTHONUSERBASE', 'PYTHONSTARTUP', 'VIRTUAL_ENV']) delete env[key];
    Object.assign(env, { PYTHONNOUSERSITE: '1', PYTHONDONTWRITEBYTECODE: '1',
      HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1', MACMIC_MODEL_PATH: this.modelPath,
      MACMIC_ASR_BACKEND: this.runtime.backend, PYTHONIOENCODING: 'utf-8',
      NUMBA_CACHE_DIR: path.join(this.root, 'cache', 'numba') });
    const script = app.isPackaged ? path.join(process.resourcesPath, 'app.asar.unpacked', 'qwen_server.py')
      : path.join(__dirname, '..', '..', 'qwen_server.py');
    const child = spawn(this.pythonCmd, ['-u', script], { env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    this.serverProcess = child;
    readline.createInterface({ input: child.stdout }).on('line', line => {
      try {
        const result = JSON.parse(line);
        const pending = this.pending.get(result.id);
        if (!pending) return;
        this.pending.delete(result.id); clearTimeout(pending.timeout);
        result.success ? pending.resolve(result) : pending.reject(new Error(result.error));
      } catch { this.logger.warn('ASR worker emitted non-JSON output'); }
    });
    child.stderr.on('data', data => this.logger.info('Qwen runtime', data.toString().slice(0, 1500)));
    const fail = error => {
      if (this.serverProcess === child) {
        this.serverProcess = null; this.serverReady = false; this.modelsInitialized = false;
        this.error = error.message;
      }
      for (const item of this.pending.values()) { clearTimeout(item.timeout); item.reject(error); }
      this.pending.clear();
    };
    child.on('error', fail);
    child.on('exit', code => fail(new Error(`本地识别服务已退出 (${code})`)));
    try {
      const status = await this.command({ action: 'init' }, 300000);
      this.backendLabel = status.backend || this.runtime.label;
      this.serverReady = true; this.modelsInitialized = true;
      this.logger.info('Qwen3-ASR 1.7B ready', { backend: this.backendLabel });
      return true;
    } catch (error) { this.error = error.message; child.kill(); throw error; }
  }
  command(payload, duration = 600000) {
    return new Promise((resolve, reject) => {
      if (!this.serverProcess?.stdin.writable) return reject(new Error('本地模型服务不可用'));
      const id = randomUUID();
      const timeout = setTimeout(() => {
        this.pending.delete(id); reject(new Error('识别超时，请重启本地模型后重试'));
        this.serverProcess?.kill();
      }, duration);
      this.pending.set(id, { resolve, reject, timeout });
      this.serverProcess.stdin.write(JSON.stringify({ ...payload, id }) + '\n', error => {
        if (error) { clearTimeout(timeout); this.pending.delete(id); reject(error); }
      });
    });
  }
  async transcribeAudio(data, options = {}) {
    let filename;
    try {
      await this.preInitializeModels();
      filename = path.join(os.tmpdir(), `macmic-${randomUUID()}.wav`);
      await fs.promises.writeFile(filename, Buffer.from(data), { mode: 0o600 });
      const result = await this.command({ action: 'transcribe', audio_path: filename, hotwords: options.hotwords || [] });
      this.logger.info('Local transcription completed', { duration: result.duration, elapsed: result.elapsed });
      return result;
    } catch (error) { return { success: false, error: error.message }; }
    finally { if (filename) await fs.promises.unlink(filename).catch(() => {}); }
  }
  stopServer() { this.serverProcess?.kill(); }
  async restartServer() {
    if (this.initializationPromise) await this.initializationPromise.catch(() => {});
    const child = this.serverProcess;
    if (child) await new Promise(resolve => { child.once('exit', resolve); child.kill(); });
    await this.preInitializeModels(); return { success: true };
  }
  getDownloadProgress() { return { status: 'complete', progress: 100 }; }
  async downloadModels() { return { success: false, error: '此版本使用已安装的 Qwen3 本地模型' }; }
  installFunASR() { return this.downloadModels(); }
  installPython() { return this.downloadModels(); }
  async findPythonExecutable() { return this.pythonCmd; }
}
module.exports = LocalAsrManager;
