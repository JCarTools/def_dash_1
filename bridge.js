/* Asynchronous JCarTools transport. No synchronous vehicle calls. */
(function (global) {
  "use strict";
  class CarBridge {
    constructor(options) {
      this.api = options.api; this.token = options.token; this.onData = options.onData;
      this.onStatus = options.onStatus || (() => {}); this.now = options.now || (() => Date.now());
      this.setTimer = options.setTimer || ((fn, ms) => setTimeout(fn, ms));
      this.clearTimer = options.clearTimer || (id => clearTimeout(id));
      this.fastMs = options.fastMs || 100; this.sequence = 0; this.session = Math.random().toString(36).slice(2);
      this.pending = null; this.timer = null; this.running = false; this.halted = false; this.retryAt = 0;
      this.signals = [
        { key: "speed", data: "speed", period: "fast" }, { key: "rpm", data: "rpm", period: "fast" },
        { key: "turnSignals", command: "get_turn_signals", period: "fast" },
        { key: "highBeam", command: "get_high_beam", period: 500 },
        { key: "fuel", data: "fuel", period: 2000 }, { key: "battery", data: "battery", period: 2000 },
        { key: "outTemp", data: "outTemp", period: 5000 }, { key: "tpms", command: "get_tpms", period: 2000 }
      ].map(s => ({ ...s, next: 0 }));
    }
    start() { if (this.running || this.halted) return; this.running = true; this.schedule(0); }
    stop() { this.running = false; this.clearTimer(this.timer); this.timer = null; }
    setInterval(ms) { this.fastMs = ms; }
    schedule(ms) { this.clearTimer(this.timer); if (this.running) this.timer = this.setTimer(() => this.tick(), ms); }
    tick() {
      if (!this.running || this.halted) return;
      const now = this.now();
      if (this.pending) {
        if (now - this.pending.started >= 5000) {
          // A timed-out Binder task may still be running. Keep its ID; never enqueue replacements.
          this.halted = true; this.onStatus("timeout"); return;
        }
        this.schedule(50); return;
      }
      if (now < this.retryAt) { this.schedule(this.retryAt - now); return; }
      const signal = this.signals.filter(s => s.next <= now).sort((a, b) => a.next - b.next)[0];
      if (!signal) { this.schedule(Math.max(10, Math.min(...this.signals.map(s => s.next)) - now)); return; }
      const method = signal.data ? "requestCarDataAsync" : "requestCarCommandAsync";
      if (!this.api || typeof this.api[method] !== "function") {
        signal.next = now + 5000; this.onStatus("unsupported"); this.schedule(25); return;
      }
      const requestId = `j-dash:${this.session}:${++this.sequence}`;
      this.pending = { requestId, signal, started: now };
      try {
        const argument = signal.data || JSON.stringify({ cmd: signal.command });
        const accepted = this.api[method](this.token, requestId, argument);
        if (accepted !== true && this.pending && this.pending.requestId === requestId) {
          this.pending = null; signal.next = now + 2000; this.retryAt = now + 2000; this.onStatus("paused");
        }
      } catch (_) { this.pending = null; signal.next = now + 2000; this.retryAt = now + 2000; this.onStatus("paused"); }
      this.schedule(this.pending ? 50 : 25);
    }
    receive(event) {
      if (typeof event === "string") { try { event = JSON.parse(event); } catch (_) { return false; } }
      if (!event || !this.pending || event.requestId !== this.pending.requestId) return false;
      const signal = this.pending.signal; this.pending = null; this.halted = false;
      signal.next = this.now() + (signal.period === "fast" ? this.fastMs : signal.period);
      let response = event.response;
      if (typeof response === "string") { try { response = JSON.parse(response); } catch (_) { response = null; } }
      if (response && !response.error && response.success !== false && response.ok !== false) {
        this.onData(signal.key, response); this.onStatus("receiving");
      } else { this.onStatus("unavailable"); }
      this.schedule(0); return true;
    }
  }
  global.CarBridge = CarBridge;
})(typeof window !== "undefined" ? window : globalThis);
