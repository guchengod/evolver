// Stable device identifier for node identity.
// Generates a hardware-based fingerprint that persists across directory changes,
// reboots, and evolver upgrades. Used by getNodeId() and env_fingerprint.

const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEVICE_ID_DIR = path.join(os.homedir(), '.evomap');
const DEVICE_ID_FILE = path.join(DEVICE_ID_DIR, 'device_id');

let _cachedDeviceId = null;

function readMachineId() {
  // Linux: /etc/machine-id is a stable, unique 128-bit ID set at OS install time
  try {
    const mid = fs.readFileSync('/etc/machine-id', 'utf8').trim();
    if (mid && mid.length >= 16) return mid;
  } catch {}

  // macOS: IOPlatformUUID via ioreg
  try {
    const { execSync } = require('child_process');
    const raw = execSync('ioreg -rd1 -c IOPlatformExpertDevice 2>/dev/null', {
      encoding: 'utf8',
      timeout: 3000,
    });
    const match = raw.match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/);
    if (match && match[1]) return match[1];
  } catch {}

  return null;
}

function getMacAddresses() {
  const ifaces = os.networkInterfaces();
  const macs = [];
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (!iface.internal && iface.mac && iface.mac !== '00:00:00:00:00:00') {
        macs.push(iface.mac);
      }
    }
  }
  macs.sort();
  return macs;
}

function generateDeviceId() {
  const machineId = readMachineId();
  if (machineId) {
    return crypto.createHash('sha256').update('evomap:' + machineId).digest('hex').slice(0, 32);
  }

  // Fallback: hostname + sorted MAC addresses
  const macs = getMacAddresses();
  if (macs.length > 0) {
    const raw = os.hostname() + '|' + macs.join(',');
    return crypto.createHash('sha256').update('evomap:' + raw).digest('hex').slice(0, 32);
  }

  // Last resort: random UUID, persisted so it stays stable
  return crypto.randomBytes(16).toString('hex');
}

function persistDeviceId(id) {
  try {
    if (!fs.existsSync(DEVICE_ID_DIR)) {
      fs.mkdirSync(DEVICE_ID_DIR, { recursive: true });
    }
    fs.writeFileSync(DEVICE_ID_FILE, id, 'utf8');
  } catch {}
}

function loadPersistedDeviceId() {
  try {
    if (fs.existsSync(DEVICE_ID_FILE)) {
      const id = fs.readFileSync(DEVICE_ID_FILE, 'utf8').trim();
      if (id && id.length >= 16) return id;
    }
  } catch {}
  return null;
}

function getDeviceId() {
  if (_cachedDeviceId) return _cachedDeviceId;

  // 1. Env var override
  if (process.env.EVOMAP_DEVICE_ID) {
    _cachedDeviceId = String(process.env.EVOMAP_DEVICE_ID);
    return _cachedDeviceId;
  }

  // 2. Previously persisted
  const persisted = loadPersistedDeviceId();
  if (persisted) {
    _cachedDeviceId = persisted;
    return _cachedDeviceId;
  }

  // 3. Generate from hardware and persist
  const generated = generateDeviceId();
  persistDeviceId(generated);
  _cachedDeviceId = generated;
  return _cachedDeviceId;
}

module.exports = { getDeviceId };
