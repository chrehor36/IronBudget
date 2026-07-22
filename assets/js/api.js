// Thin wrapper over window.pywebview.api - waits for the bridge to be ready.
const IB_API = {
  _ready: null,
  ready() {
    if (this._ready) return this._ready;
    this._ready = new Promise((resolve) => {
      if (window.pywebview && window.pywebview.api) { resolve(); return; }
      window.addEventListener('pywebviewready', () => resolve());
    });
    return this._ready;
  },
  async call(method, ...args) {
    await this.ready();
    return window.pywebview.api[method](...args);
  },
};
