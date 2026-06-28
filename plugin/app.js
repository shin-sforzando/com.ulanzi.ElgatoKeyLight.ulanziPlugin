// Elgato Key Light main service for UlanziDeck.
//
// Connects to Ulanzi Studio as the plugin's main service (4-segment UUID =>
// the SDK treats this connection as `isMain`) and translates deck actions into
// Elgato Key Light HTTP calls.
//
// Key Light HTTP API (per device, port 9123):
//   GET  http://<ip>:9123/elgato/lights            -> current state
//   PUT  http://<ip>:9123/elgato/lights            -> set { on, brightness, temperature }
//   GET  http://<ip>:9123/elgato/accessory-info    -> device metadata
//   brightness: 0..100, temperature: 143..344 (mired; lower = cooler), on: 0|1
//
// State model: a light is one physical device identified by its IP, but several
// deck actions (a Toggle key and a Dial encoder) can target the same light.
// State is therefore keyed by IP, and whenever a light changes every action
// instance pointing at that IP is re-rendered so their icons stay consistent
// (e.g. turning the light on from the dial flips the Toggle key to "on").

import UlanziApi from "../plugin-common-node/index.js";
import { KeyLightDiscovery } from "./discovery.js";

const PLUGIN_UUID = "com.ulanzi.ulanzistudio.elgatokeylight";

// Elgato temperature is expressed in mired within this inclusive range.
const TEMP_MIN = 143;
const TEMP_MAX = 344;
const STEP = 5; // dial increment per rotate tick
const PUT_DEBOUNCE_MS = 80; // coalesce rapid dial ticks into one PUT

const $UD = new UlanziApi();
const discovery = new KeyLightDiscovery();

// Authoritative state per physical light (keyed by IP).
const lights = new Map(); // ip -> { on, brightness, temperature }
function lightOf(ip) {
  if (!lights.has(ip)) {
    lights.set(ip, { on: 0, brightness: 20, temperature: 200 });
  }
  return lights.get(ip);
}

// Per-action-instance info, keyed by SDK context (uuid___key___actionid).
const actions = new Map(); // context -> { ip, kind: "toggle" | "dial" }
function kindOf(context) {
  // The action UUID is the first context segment; it ends with .toggle or .dial.
  const uuid = String(context).split("___")[0] || "";
  return uuid.endsWith(".dial") ? "dial" : "toggle";
}
function actionOf(context) {
  if (!actions.has(context)) {
    actions.set(context, { ip: "", kind: kindOf(context) });
  }
  return actions.get(context);
}

// Contexts whose Property Inspector is currently open; used to push live
// discovery updates back to the PI.
const openInspectors = new Set();

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

async function keyLightFetch(ip, init) {
  // Short timeout so an unreachable/asleep light never hangs the service.
  const res = await fetch(`http://${ip}:9123/elgato/lights`, {
    ...init,
    signal: AbortSignal.timeout(2000),
  });
  if (!res.ok) throw new Error(`Key Light HTTP ${res.status}`);
  const json = await res.json();
  return json.lights?.[0] ?? {};
}

function getLight(ip) {
  return keyLightFetch(ip, { method: "GET" });
}

function putLight(ip, light) {
  return keyLightFetch(ip, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ numberOfLights: 1, lights: [light] }),
  });
}

function renderIcon(context, info, l) {
  // Toggle has two states (0=Off, 1=On); Dial has a single state (index 0).
  // Both show the current brightness as overlay text.
  const state = info.kind === "toggle" ? (l.on ? 1 : 0) : 0;
  $UD.setStateIcon(context, state, `${l.brightness}%`);
}

// Re-render every action instance that targets this light so all icons agree.
function syncLight(ip) {
  if (!ip) return;
  const l = lightOf(ip);
  for (const [context, info] of actions) {
    if (info.ip === ip) renderIcon(context, info, l);
  }
}

// Fetch the live light state, then refresh all actions pointing at it.
async function refreshLight(ip) {
  if (!ip) return;
  try {
    Object.assign(lightOf(ip), await getLight(ip));
  } catch {
    // Light may be offline; keep last-known state.
  }
  syncLight(ip);
}

// Debounced PUT of brightness/temperature for dial interactions, keyed by light.
const putTimers = new Map();
function scheduleLightPut(ip) {
  clearTimeout(putTimers.get(ip));
  putTimers.set(
    ip,
    setTimeout(async () => {
      const l = lightOf(ip);
      try {
        const r = await putLight(ip, {
          on: 1,
          brightness: l.brightness,
          temperature: l.temperature,
        });
        Object.assign(l, r);
        l.on = 1;
        syncLight(ip);
      } catch (e) {
        $UD.logMessage(`Key Light PUT failed: ${e.message}`, "error");
      }
    }, PUT_DEBOUNCE_MS)
  );
}

$UD.connect(PLUGIN_UUID);

$UD.onConnected(() => {
  $UD.logMessage("Elgato Key Light main service connected", "info");
  discovery.start();
});

// Register an action instance and restore its persisted IP.
function bindAction(context, ip) {
  const info = actionOf(context);
  if (ip) info.ip = ip;
  if (info.ip) refreshLight(info.ip);
}
$UD.onAdd((m) => {
  // `add` does not carry saved settings, so register the instance and request
  // them — the saved IP arrives via onDidReceiveSettings. This restores every
  // action's light on load without needing its Property Inspector opened, so a
  // dial change correctly updates a sibling Toggle key targeting the same light.
  actionOf(m.context);
  $UD.getSettings(m.context);
});
// The host delivers saved settings in the `settings` field (not `param`).
$UD.onDidReceiveSettings((m) => bindAction(m.context, m.settings?.ip));

// Toggle on/off.
$UD.onRun(async (m) => {
  const info = actionOf(m.context);
  if (!info.ip) return $UD.showAlert(m.context);
  const l = lightOf(info.ip);
  try {
    const r = await putLight(info.ip, { on: l.on ? 0 : 1 });
    Object.assign(l, r);
    syncLight(info.ip);
  } catch (e) {
    $UD.logMessage(`Key Light toggle failed: ${e.message}`, "error");
    $UD.showAlert(m.context);
  }
});

// Dial: rotate => brightness, hold + rotate => color temperature.
function adjust(context, mutate) {
  const info = actionOf(context);
  if (!info.ip) return;
  mutate(lightOf(info.ip));
  scheduleLightPut(info.ip);
}
$UD.onDialRotateRight((m) =>
  adjust(m.context, (l) => (l.brightness = clamp(l.brightness + STEP, 0, 100)))
);
$UD.onDialRotateLeft((m) =>
  adjust(m.context, (l) => (l.brightness = clamp(l.brightness - STEP, 0, 100)))
);
$UD.onDialRotateHoldRight((m) =>
  adjust(m.context, (l) => (l.temperature = clamp(l.temperature + STEP, TEMP_MIN, TEMP_MAX)))
);
$UD.onDialRotateHoldLeft((m) =>
  adjust(m.context, (l) => (l.temperature = clamp(l.temperature - STEP, TEMP_MIN, TEMP_MAX)))
);

// Messages from the Property Inspector: device selection and discovery requests.
$UD.onSendToPlugin(async (m) => {
  const payload = m.payload ?? m.param ?? {};
  openInspectors.add(m.context);
  // The PI just opened/interacted — trigger an immediate mDNS query so its
  // device list is fresh without relying on the slow steady-state polling.
  discovery.refresh();

  if (payload.ip !== undefined) {
    const info = actionOf(m.context);
    info.ip = payload.ip;
    $UD.setSettings({ ip: info.ip }, m.context);
    await refreshLight(info.ip);
  }

  // Always answer with the current device list so the PI can populate its picker.
  $UD.sendToPropertyInspector({ devices: discovery.getDevices() }, m.context);
});

// Push live discovery changes to every open Property Inspector.
discovery.onChange((devices) => {
  for (const context of openInspectors) {
    $UD.sendToPropertyInspector({ devices }, context);
  }
});
