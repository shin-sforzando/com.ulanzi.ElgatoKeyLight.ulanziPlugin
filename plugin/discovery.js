// mDNS discovery for Elgato Key Light devices.
//
// Elgato lights advertise the service type `_elg._tcp.local`. Discovery must run
// in the Node main service: the Property Inspector is sandboxed browser HTML and
// cannot do multicast DNS. Discovered devices are surfaced to the PI by app.js.

import { Bonjour } from "bonjour-service";

// Prefer an IPv4 address; the Elgato HTTP API is reached over IPv4 in practice.
function pickIPv4(addresses = []) {
  return (
    addresses.find((a) => /^\d+\.\d+\.\d+\.\d+$/.test(a)) || addresses[0] || ""
  );
}

export class KeyLightDiscovery {
  constructor() {
    this._bonjour = null;
    this._browser = null;
    this._queryTimer = null;
    this._devices = new Map(); // fqdn -> { name, ip, port }
    this._onChange = null;
  }

  // Register a callback fired whenever the device set changes.
  onChange(cb) {
    this._onChange = cb;
    return this;
  }

  start() {
    if (this._browser) return this;
    this._bonjour = new Bonjour();
    this._browser = this._bonjour.find({ type: "elg", protocol: "tcp" });

    this._browser.on("up", (service) => {
      const ip = pickIPv4(service.addresses);
      if (!ip) return;
      this._devices.set(service.fqdn || service.name, {
        name: service.name || "Key Light",
        ip,
        port: service.port || 9123,
      });
      this._emit();
    });

    this._browser.on("down", (service) => {
      this._devices.delete(service.fqdn || service.name);
      this._emit();
    });

    // A single mDNS query is unreliable on multi-homed hosts (multiple NICs on
    // the same subnet): the response can be missed. Re-issue the query on a
    // backoff schedule — a short burst reliably catches devices at startup,
    // then it settles to an infrequent steady query just to track lights being
    // powered on/off. For immediate results when the user opens the Property
    // Inspector, call refresh() instead of polling fast forever.
    const backoff = [1000, 2000, 4000, 8000];
    let i = 0;
    const tick = () => {
      this._query();
      const delay = backoff[i] ?? 30000;
      if (i < backoff.length) i++;
      this._queryTimer = setTimeout(tick, delay);
    };
    this._queryTimer = setTimeout(tick, backoff[0]);

    return this;
  }

  _query() {
    if (this._browser && typeof this._browser.update === "function") {
      this._browser.update();
    }
  }

  // Force an immediate mDNS query (e.g. when a Property Inspector opens).
  refresh() {
    this._query();
    return this;
  }

  // Snapshot of currently known devices.
  getDevices() {
    return [...this._devices.values()];
  }

  _emit() {
    if (this._onChange) this._onChange(this.getDevices());
  }

  stop() {
    if (this._queryTimer) clearTimeout(this._queryTimer);
    if (this._browser) this._browser.stop();
    if (this._bonjour) this._bonjour.destroy();
    this._queryTimer = null;
    this._browser = null;
    this._bonjour = null;
    this._devices.clear();
  }
}
