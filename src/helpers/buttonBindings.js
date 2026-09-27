// macmic modifications Copyright 2026 bushushu2333. Derived from yan5xu/ququ; see NOTICE and LICENSE.
// Peripheral adapter: registers user-bound buttons (e.g. a programmable
// Bluetooth remote) as global shortcuts and dispatches them to macmic actions.
const { globalShortcut } = require('electron');

class ButtonBindings {
  constructor(logger = null) {
    this.logger = logger;
    this.handlers = {};
    this.bindings = [];
    this.registered = new Map(); // accelerator -> callback
    this.statuses = [];
  }

  // (Re)apply a binding list. Returns one status per binding so the settings
  // UI can surface accelerators the OS refused (already taken by another app).
  apply(bindings, handlers = this.handlers) {
    this.handlers = handlers;
    for (const accelerator of this.registered.keys()) globalShortcut.unregister(accelerator);
    this.registered.clear();
    this.bindings = bindings;
    this.statuses = bindings.map(({ accelerator, action }) => {
      const handler = handlers[action];
      if (!handler) return { accelerator, action, ok: false };
      const callback = () => handler();
      if (!globalShortcut.register(accelerator, callback)) {
        this.logger?.info(`外设按键 ${accelerator} 注册失败，可能被其他应用占用`);
        return { accelerator, action, ok: false };
      }
      this.registered.set(accelerator, callback);
      return { accelerator, action, ok: true };
    });
    return this.statuses;
  }

  reapply() {
    if (this.bindings.length) return this.apply(this.bindings, this.handlers);
    return this.statuses;
  }

  // Free every accelerator before key-capture in the settings window, otherwise
  // a registered F13 never reaches the renderer as a keydown event.
  suspend() {
    for (const accelerator of this.registered.keys()) globalShortcut.unregister(accelerator);
    this.registered.clear();
    this.statuses = this.statuses.map(status => ({ ...status, ok: false }));
  }

  stop() {
    this.suspend();
    this.bindings = [];
  }
}

module.exports = ButtonBindings;
