// macmic modifications Copyright 2026 bushushu2333. Derived from yan5xu/ququ; see NOTICE and LICENSE.
const { BrowserWindow, screen } = require('electron');
const path = require('path');

class WindowManager {
  constructor() {
    this.mainWindow = null;
    this.controlPanelWindow = null;
    this.quitting = false;
  }
  preferences() {
    return { nodeIntegration: false, contextIsolation: true, backgroundThrottling: false,
      preload: path.join(__dirname, '..', '..', 'preload.js') };
  }
  async load(window, query = {}) {
    if (process.env.NODE_ENV === 'development') {
      await window.loadURL('http://localhost:5173/?' + new URLSearchParams(query));
    } else await window.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), { query });
  }
  async createMainWindow() {
    if (this.mainWindow) return this.mainWindow;
    this.mainWindow = new BrowserWindow({ width: 420, height: 112, show: false,
      frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false,
      alwaysOnTop: true, resizable: false, skipTaskbar: true, focusable: false,
      movable: false, webPreferences: this.preferences() });
    if (process.platform === 'darwin') this.mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    this.mainWindow.setAlwaysOnTop(true, 'floating');
    this.mainWindow.on('close', event => {
      if (!this.quitting) { event.preventDefault(); this.mainWindow.hide(); }
    });
    this.mainWindow.on('closed', () => { this.mainWindow = null; });
    await this.load(this.mainWindow);
    return this.mainWindow;
  }
  showOverlay() {
    if (!this.mainWindow) return;
    if (!this.mainWindow.isVisible()) {
      const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
      this.mainWindow.setPosition(Math.round(area.x + (area.width - 420) / 2), area.y + area.height - 132);
    }
    this.mainWindow.showInactive();
  }
  async createControlPanelWindow() {
    if (this.controlPanelWindow) return this.controlPanelWindow;
    this.controlPanelWindow = new BrowserWindow({ width: 860, height: 660,
      minWidth: 760, minHeight: 580, show: false, title: '麦麦',
      backgroundColor: process.platform === 'darwin' ? '#00000000' : '#f5f5f7',
      ...(process.platform === 'darwin' ? { vibrancy: 'sidebar', visualEffectState: 'active', trafficLightPosition: { x: 18, y: 18 } } : {}), titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
      autoHideMenuBar: true,
      webPreferences: this.preferences() });
    this.controlPanelWindow.on('close', event => {
      if (!this.quitting) { event.preventDefault(); this.controlPanelWindow.hide(); }
    });
    this.controlPanelWindow.on('closed', () => { this.controlPanelWindow = null; });
    await this.load(this.controlPanelWindow, { panel: 'control' });
    return this.controlPanelWindow;
  }
  async showControlPanel() {
    const window = await this.createControlPanelWindow();
    if (window.isMinimized()) window.restore();
    window.show(); window.focus();
  }
  hideControlPanel() { this.controlPanelWindow?.hide(); }
  showHistoryWindow() { return this.showControlPanel(); }
  showSettingsWindow() { return this.showControlPanel(); }
  hideHistoryWindow() { this.hideControlPanel(); }
  hideSettingsWindow() { this.hideControlPanel(); }
  closeHistoryWindow() { this.hideControlPanel(); }
  closeSettingsWindow() { this.hideControlPanel(); }
  closeAllWindows() { this.mainWindow?.hide(); this.hideControlPanel(); }
}
module.exports = WindowManager;
