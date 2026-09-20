// macmic modifications Copyright 2026 bushushu2333. Derived from yan5xu/ququ; see NOTICE and LICENSE.
const { Tray, Menu, nativeImage, app } = require('electron');
const path = require('path');

class TrayManager {
  constructor(logger) { this.logger = logger; }
  setWindows(mainWindow, controlPanelWindow) {
    this.mainWindow = mainWindow; this.controlPanelWindow = controlPanelWindow;
  }
  setCreateControlPanelCallback(callback) { this.createControlPanelCallback = callback; }
  async showPanel() {
    const window = this.controlPanelWindow && !this.controlPanelWindow.isDestroyed()
      ? this.controlPanelWindow : await this.createControlPanelCallback();
    this.controlPanelWindow = window;
    if (window.isMinimized()) window.restore();
    window.show(); window.focus();
  }
  async createTray() {
    try {
      const mac = process.platform === 'darwin';
      const shortcut = mac ? '⌘⇧Space / 右 ⌘' : 'Ctrl+Shift+Space';
      const icon = nativeImage.createFromPath(path.join(__dirname, '..', '..', 'assets', mac ? 'trayTemplate.png' : 'icon.png')).resize({ width: 20, height: 20 });
      if (mac) icon.setTemplateImage(true);
      this.tray = new Tray(icon);
      this.tray.setToolTip(`麦麦 · ${shortcut} 开始语音输入`);
      if (!mac) this.tray.on('double-click', () => this.showPanel());
      this.tray.setContextMenu(Menu.buildFromTemplate([
        { label: `麦麦 · ${shortcut}`, enabled: false },
        { type: 'separator' },
        { label: '打开麦麦', click: () => this.showPanel() },
        { label: '开始 / 结束录音', click: () => this.mainWindow?.webContents.send('toggle-dictation') },
        { type: 'separator' },
        { label: '退出麦麦', click: () => app.quit() }
      ]));
    } catch (error) { this.logger.error('菜单栏创建失败', error.message); }
  }
  setStatus(status) { this.tray?.setToolTip(`麦麦 · ${status}`); }
  destroy() { this.tray?.destroy(); }
}
module.exports = TrayManager;
