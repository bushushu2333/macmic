const { app } = require('electron');
const { spawn } = require('node:child_process');
const path = require('node:path');
const readline = require('node:readline');

class NativeShortcut {
  constructor(onTrigger, logger = null) {
    this.onTrigger = onTrigger;
    this.logger = logger;
    this.child = null;
    this.timer = null;
    this.ready = false;
    this.lastStatus = 0;
    this.stopped = true;
    this.watchdog = null;
  }
  isReady() { return this.ready && Date.now() - this.lastStatus < 15000; }
  start() {
    if (!['darwin', 'win32'].includes(process.platform) || this.child) return;
    this.stopped = false;
    clearTimeout(this.timer);
    const filename = process.platform === 'win32' ? 'macmic-hotkey.exe' : 'macmic-hotkey';
    const executable = app.isPackaged ? path.join(process.resourcesPath, 'native', filename)
      : path.join(__dirname, '..', '..', 'native', 'bin', filename);
    const args = process.platform === 'win32' ? ['--parent-pid', String(process.pid)] : [];
    const child = spawn(executable, args, { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
    this.child = child;
    this.lastStatus = Date.now();
    this.watchdog = setInterval(() => {
      if (this.child === child && Date.now() - this.lastStatus > 20000) this.restart();
    }, 10000);
    const lines = readline.createInterface({ input: child.stdout });
    lines.on('line', line => {
      if (this.child !== child) return;
      try {
        const value = JSON.parse(line);
        if (value.type === 'status') {
          const ready = value.ready === true;
          if (this.ready !== ready) this.logger?.info('原生快捷键连接状态', { ready });
          this.ready = ready; this.lastStatus = Date.now();
        }
        if (value.type === 'trigger' && this.isReady()) this.onTrigger();
      } catch { /* Only the two fixed protocol messages are accepted. */ }
    });
    const ended = () => {
      lines.close();
      if (this.child !== child) return;
      clearInterval(this.watchdog);
      this.child = null; this.ready = false;
      if (!this.stopped) this.timer = setTimeout(() => this.start(), 15000);
    };
    child.once('error', ended);
    child.once('exit', ended);
  }
  restart() { this.stop(); this.start(); }
  stop() {
    this.stopped = true; clearTimeout(this.timer); clearInterval(this.watchdog);
    const child = this.child; this.child = null; this.ready = false;
    child?.kill();
  }
}
module.exports = NativeShortcut;
