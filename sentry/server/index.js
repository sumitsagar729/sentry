const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const sql = require('mssql');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));

const DATA_DIR = path.join(__dirname, 'data');

const sqlConfig = {
  server: '10.14.65.238',
  database: 'snl-db',
  options: {
    trustServerCertificate: true,
    trustedConnection: true,
  },
  driver: 'msnodesqlv8',
  authentication: {
    type: 'default',
    options: { domain: '', userName: 'sa', password: 'awvmware331!' },
  },
  pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
};

function readJSON(filename) {
  return JSON.parse(fs.readFileSync(path.join(DATA_DIR, filename), 'utf8'));
}

function writeJSON(filename, data) {
  fs.writeFileSync(path.join(DATA_DIR, filename), JSON.stringify(data, null, 2), 'utf8');
}

const SNAPSHOT_FILE = 'deviceDomainsSnapshot.json';

function snapshotExists() {
  return fs.existsSync(path.join(DATA_DIR, SNAPSHOT_FILE));
}

function loadSnapshot() {
  try { return readJSON(SNAPSHOT_FILE); } catch { return null; }
}

function saveSnapshot(deviceDomains) {
  try { writeJSON(SNAPSHOT_FILE, deviceDomains); } catch (err) {
    console.warn('Failed to save chart snapshot:', err.message);
  }
}

// Create fresh chart data. Guarantees every red-flag domain is visited
// on at least one device (low counts) so the red-flag chart has data for all.
function generateDeviceDomains(devices) {
  const masterDomains = readJSON('masterDomains.json');
  const redFlagDomains = readJSON('redFlagDomains.json');
  const allDomains = [...masterDomains, ...redFlagDomains];

  const deviceDomains = {};
  for (const device of devices) {
    const id = device.DeviceIdentifier;
    const count = 40 + Math.floor(Math.random() * 11);
    const shuffled = [...allDomains].sort(() => 0.5 - Math.random());
    const picked = shuffled.slice(0, count);
    const visits = picked.map((domain) => ({
      domain,
      visitCount: Math.floor(Math.random() * 200) + 1,
      lastVisited: new Date(Date.now() - Math.floor(Math.random() * 30 * 24 * 60 * 60 * 1000)).toISOString(),
      isRedFlag: redFlagDomains.includes(domain),
    }));
    deviceDomains[id] = visits;
  }

  // Make sure every red-flag domain has SOME presence so the RF chart
  // always shows the full list from redFlagDomains.json.
  if (devices.length > 0) {
    for (const rf of redFlagDomains) {
      const touched = Object.values(deviceDomains).some((vs) => vs.some((v) => v.domain === rf));
      if (!touched) {
        const devCount = 1 + Math.floor(Math.random() * Math.min(3, devices.length));
        const picks = [...devices].sort(() => 0.5 - Math.random()).slice(0, devCount);
        for (const dev of picks) {
          deviceDomains[dev.DeviceIdentifier].push({
            domain: rf,
            visitCount: 1 + Math.floor(Math.random() * 10),
            lastVisited: new Date(Date.now() - Math.floor(Math.random() * 7 * 24 * 60 * 60 * 1000)).toISOString(),
            isRedFlag: true,
          });
        }
      }
    }
  }

  return deviceDomains;
}

// Apply a small, realistic increment to an existing snapshot so the charts
// "drift" on refresh instead of flipping wildly.
// - ~70% of domain rows get +0..2 visits
// - occasionally bumps a random domain by a larger amount (+3..8)
// - ~25% chance to add ONE new domain to ONE random device per refresh
// - refreshes lastVisited on a handful of rows to "now"
function applyIncrementalUpdate(deviceDomains, devices) {
  const masterDomains = readJSON('masterDomains.json');
  const redFlagDomains = readJSON('redFlagDomains.json');
  const rfSet = new Set(redFlagDomains);
  const allDomains = [...masterDomains, ...redFlagDomains];
  const now = Date.now();

  for (const deviceId of Object.keys(deviceDomains)) {
    const visits = deviceDomains[deviceId];
    for (const v of visits) {
      const r = Math.random();
      if (r < 0.70) v.visitCount += Math.floor(Math.random() * 3);        // +0..2
      else if (r < 0.95) v.visitCount += 0;                                // idle
      else v.visitCount += 3 + Math.floor(Math.random() * 6);              // spike +3..8
    }
    // Refresh lastVisited on a few rows
    const refreshCount = Math.min(3, visits.length);
    for (let i = 0; i < refreshCount; i++) {
      const idx = Math.floor(Math.random() * visits.length);
      visits[idx].lastVisited = new Date(now - Math.floor(Math.random() * 6 * 60 * 60 * 1000)).toISOString();
    }
  }

  // Occasionally introduce a brand-new domain visit to a random device.
  if (devices.length > 0 && Math.random() < 0.25) {
    const dev = devices[Math.floor(Math.random() * devices.length)];
    const existingSet = new Set((deviceDomains[dev.DeviceIdentifier] || []).map((v) => v.domain));
    const candidates = allDomains.filter((d) => !existingSet.has(d));
    if (candidates.length > 0) {
      const domain = candidates[Math.floor(Math.random() * candidates.length)];
      if (!deviceDomains[dev.DeviceIdentifier]) deviceDomains[dev.DeviceIdentifier] = [];
      deviceDomains[dev.DeviceIdentifier].push({
        domain,
        visitCount: 1 + Math.floor(Math.random() * 5),
        lastVisited: new Date(now - Math.floor(Math.random() * 60 * 60 * 1000)).toISOString(),
        isRedFlag: rfSet.has(domain),
      });
    }
  }

  // Ensure new devices (not in snapshot) get a fresh domain block.
  for (const dev of devices) {
    if (!deviceDomains[dev.DeviceIdentifier]) {
      const fresh = generateDeviceDomains([dev]);
      deviceDomains[dev.DeviceIdentifier] = fresh[dev.DeviceIdentifier];
    }
  }

  return deviceDomains;
}

function snapshotMatchesDevices(snapshot, devices) {
  if (!snapshot) return false;
  const snapIds = new Set(Object.keys(snapshot));
  // Consider it usable if at least one overlapping device id exists.
  // (We then reconcile additions/removals incrementally.)
  return devices.some((d) => snapIds.has(d.DeviceIdentifier));
}

function loadOrBuildDeviceDomains(devices) {
  const existing = loadSnapshot();
  if (snapshotMatchesDevices(existing, devices)) {
    const updated = applyIncrementalUpdate(existing, devices);
    saveSnapshot(updated);
    return updated;
  }
  const fresh = generateDeviceDomains(devices);
  saveSnapshot(fresh);
  return fresh;
}

// let cachedDevices = null;
let cachedDeviceDomains = null;
const FORCE_FALLBACK_DATA = process.env.USE_FALLBACK_DATA === 'true';
let sqlUnavailable = FORCE_FALLBACK_DATA;
let sqlFailureLogged = false;

async function getDevicesFromDB() {
  console.log("sqlUnavailable", sqlUnavailable);
  console.log("FORCE_FALLBACK_DATA", FORCE_FALLBACK_DATA);
  // if (sqlUnavailable) return getFallbackDevices();
  try {
    const pool = await sql.connect(sqlConfig);
    const result = await pool.request().query("SELECT * FROM dbo.Device");
    return result.recordset;
  } catch (err) {
    sqlUnavailable = true;
    if (!sqlFailureLogged) {
      console.warn('SQL Server connection failed, switching to fallback data mode:', err.message);
      sqlFailureLogged = true;
    }
    return [];//getFallbackDevices();
  }
}

function getFallbackDevices() {
  return [
    { DeviceID: 1542, DeviceIdentifier: 'f176f737856642ef901d55edc1a670f5', OEMInfo: 'Desktop', Platform: 'WinRT', OSMajorVersion: 10, OSMinorVersion: 0, OSBuildNumber: 19044, FriendlyName: 'user1 Desktop Windows Desktop 10.0.19044 3 6c', SerialNumber: 'VMware-56 4d f0 12 a0 40 c6 cb-3d b5 c1 ca d5 6c 53 6c', DeviceReportedName: 'DESKTOP-V2UQFJI', IsManaged: 1, EnrollmentStatusID: 4, ComplianceStatusID: 5, EnrollmentDate: '2022-11-14T15:19:29.730Z', CreatedOn: '2022-08-05T05:47:05.070Z', CustomerCode: 'd74ac821', TunnelActive: 0, DisplayModel: 'Desktop', LocationGroupID: 2230 },
    { DeviceID: 4877, DeviceIdentifier: 'EE802EDB2B71EB479C5E52363513B297', OEMInfo: 'Desktop', Platform: 'WinRT', OSMajorVersion: 10, OSMinorVersion: 0, OSBuildNumber: 22000, FriendlyName: 'user1 Desktop Windows Desktop 10.0.22000 03D3', SerialNumber: 'JZ003D3', DeviceReportedName: 'vipulj1-z02', IsManaged: 1, EnrollmentStatusID: 4, ComplianceStatusID: 5, EnrollmentDate: '2022-11-11T05:17:39.083Z', CreatedOn: '2022-11-10T12:41:26.990Z', CustomerCode: 'chi', TunnelActive: 0, DisplayModel: 'Desktop', LocationGroupID: 2230 },
    { DeviceID: 5144, DeviceIdentifier: '4b7f394bbefd4267a6351b2d03bf587a', OEMInfo: 'Desktop', Platform: 'WinRT', OSMajorVersion: 10, OSMinorVersion: 0, OSBuildNumber: 19044, FriendlyName: 'DG_User1 Desktop Windows Desktop 10.0.19044 b 25', SerialNumber: 'VMware-42 01 c6 03 41 c5 a8 c8-f1 33 1d a9 48 32 2b 25', DeviceReportedName: 'WIN10ETCHANGEME', IsManaged: 1, EnrollmentStatusID: 4, ComplianceStatusID: 5, EnrollmentDate: '2022-11-25T11:48:59.353Z', CreatedOn: '2022-11-25T10:23:26.373Z', CustomerCode: 'UT', TunnelActive: 0, DisplayModel: 'Desktop', LocationGroupID: 3989 },
    { DeviceID: 8476, DeviceIdentifier: '113c7a9749594af2b585028c3ffbd5f9', OEMInfo: 'Desktop', Platform: 'WinRT', OSMajorVersion: 10, OSMinorVersion: 0, OSBuildNumber: 19044, FriendlyName: 'a Desktop Windows Desktop 10.0.19044 9 6a', SerialNumber: 'VMware-56 4d 6c 22 da dc 4d 9f-e3 96 a7 94 e2 ae 59 6a', DeviceReportedName: 'WIN10ETCHANGEME', IsManaged: 0, EnrollmentStatusID: 8, ComplianceStatusID: 5, EnrollmentDate: '2023-05-22T13:24:09.850Z', CreatedOn: '2023-05-22T13:24:09.247Z', CustomerCode: 'nj', TunnelActive: 0, DisplayModel: 'Desktop', LocationGroupID: 580 },
    { DeviceID: 8501, DeviceIdentifier: '08d3f46fd8cc45c9942ada664f22c6d8', OEMInfo: 'Desktop', Platform: 'WinRT', OSMajorVersion: 10, OSMinorVersion: 0, OSBuildNumber: 19045, FriendlyName: 'bkwok Desktop Windows Desktop 10.0.19045 d cd', SerialNumber: 'VMware-42 01 98 65 aa 97 17 bb-98 a8 3b 9f 1b 37 ad cd', DeviceReportedName: 'WIN10ETCHANGEME', IsManaged: 1, EnrollmentStatusID: 4, ComplianceStatusID: 5, EnrollmentDate: '2023-06-29T06:31:48.173Z', CreatedOn: '2023-05-31T07:19:17.087Z', CustomerCode: 'benson', TunnelActive: 0, DisplayModel: 'Desktop', LocationGroupID: 2231 },
    { DeviceID: 8507, DeviceIdentifier: '8f38c3e4f7414ec89caf0bec25edf458', OEMInfo: 'Desktop', Platform: 'WinRT', OSMajorVersion: 10, OSMinorVersion: 0, OSBuildNumber: 22000, FriendlyName: 'a Desktop Windows Desktop 10.0.22000 1 e5', SerialNumber: 'VMware-42 01 53 89 c0 fb ca 16-35 c4 02 a2 75 1e b1 e5', DeviceReportedName: 'WINDOWS11', IsManaged: 0, EnrollmentStatusID: 8, ComplianceStatusID: 5, EnrollmentDate: '2023-06-02T08:09:53.820Z', CreatedOn: '2023-06-02T08:09:53.017Z', CustomerCode: 'nj', TunnelActive: 0, DisplayModel: 'Desktop', LocationGroupID: 580 },
    { DeviceID: 8547, DeviceIdentifier: 'a159dda2671e457bb1642c4e5edad9b1', OEMInfo: 'Desktop', Platform: 'WinRT', OSMajorVersion: 10, OSMinorVersion: 0, OSBuildNumber: 19045, FriendlyName: 'bkwok Desktop Windows Desktop 10.0.19045 5 0f', SerialNumber: 'VMware-56 4d df d6 b3 f9 3e ed-d0 e2 64 29 cc b7 25 0f', DeviceReportedName: 'DESKTOP-7SVT9IJ', IsManaged: 1, EnrollmentStatusID: 4, ComplianceStatusID: 5, EnrollmentDate: '2023-06-09T13:58:17.823Z', CreatedOn: '2023-06-06T07:22:26.750Z', CustomerCode: 'benson', TunnelActive: 0, DisplayModel: 'Desktop', LocationGroupID: 2231 },
    { DeviceID: 8617, DeviceIdentifier: '1b1f326a70e442eb802c3e0c470c0420', OEMInfo: 'Desktop', Platform: 'WinRT', OSMajorVersion: 10, OSMinorVersion: 0, OSBuildNumber: 19044, FriendlyName: 't Desktop Windows Desktop 10.0.19044 5 42', SerialNumber: 'VMware-56 4d b7 6f 31 23 bf 00-67 39 51 04 46 13 85 42', DeviceReportedName: 'DESKTOP-A34VPAM', IsManaged: 1, EnrollmentStatusID: 4, ComplianceStatusID: 5, EnrollmentDate: '2023-06-13T07:28:52.033Z', CreatedOn: '2023-06-13T07:28:51.830Z', CustomerCode: 'HK', TunnelActive: 0, DisplayModel: 'Desktop', LocationGroupID: 577 },
    { DeviceID: 8636, DeviceIdentifier: '485AEAFFF141BC44AE72A14589EED130', OEMInfo: 'Desktop', Platform: 'WinRT', OSMajorVersion: 10, OSMinorVersion: 0, OSBuildNumber: 19045, FriendlyName: 'krabish Desktop Windows Desktop 10.0.19045 0 96', SerialNumber: 'VMware-56 4d 2c 30 73 35 a4 a6-cf 4a 7a d0 92 70 c0 96', DeviceReportedName: 'DESKTOP-8SDF269', IsManaged: 1, EnrollmentStatusID: 4, ComplianceStatusID: 5, EnrollmentDate: '2023-06-26T08:15:27.890Z', CreatedOn: '2023-06-16T04:21:12.600Z', CustomerCode: 'rk', TunnelActive: 0, DisplayModel: 'Desktop', LocationGroupID: 12389 },
    { DeviceID: 8712, DeviceIdentifier: '95C64B4EA541DE478385AE56D39AE484', OEMInfo: 'Desktop', Platform: 'WinRT', OSMajorVersion: 10, OSMinorVersion: 0, OSBuildNumber: 19045, FriendlyName: 'krabish Desktop Windows Desktop 10.0.19045 a 30', SerialNumber: 'VMware-42 01 34 16 f1 9d 78 9b-6f fa 2a ff 92 28 7a 30', DeviceReportedName: 'WIN_10_KRABISH', IsManaged: 0, EnrollmentStatusID: 8, ComplianceStatusID: 5, EnrollmentDate: '2023-06-26T14:11:44.933Z', CreatedOn: '2023-06-26T13:15:10.580Z', CustomerCode: 'rk', TunnelActive: 0, DisplayModel: 'Desktop', LocationGroupID: 12389 },
    { DeviceID: 8731, DeviceIdentifier: '0b59e7e1ae3d47a5ba222186c607b6fd', OEMInfo: 'Desktop', Platform: 'WinRT', OSMajorVersion: 10, OSMinorVersion: 0, OSBuildNumber: 19045, FriendlyName: 'bkwok Desktop Windows Desktop 10.0.19045 e 0c', SerialNumber: 'VMware-42 01 21 2a c0 43 85 79-12 41 b0 ef 3d bb fe 0c', DeviceReportedName: 'WIN10ETCHANGEME', IsManaged: 1, EnrollmentStatusID: 4, ComplianceStatusID: 5, EnrollmentDate: '2023-06-29T06:02:00.433Z', CreatedOn: '2023-06-29T05:43:30.087Z', CustomerCode: 'benson', TunnelActive: 0, DisplayModel: 'Desktop', LocationGroupID: 2231 },
    { DeviceID: 9054, DeviceIdentifier: 'BFB65AFEAA7DE84CBC8B7935969F7218', OEMInfo: 'Desktop', Platform: 'WinRT', OSMajorVersion: 10, OSMinorVersion: 0, OSBuildNumber: 19045, FriendlyName: 'nj Desktop Windows Desktop 10.0.19045 4 3b', SerialNumber: 'VMware-42 01 c9 7c 1e 61 e2 1e-8f 11 d0 64 2b 0d 54 3b', DeviceReportedName: 'WIN10ETCHANGEME', IsManaged: 1, EnrollmentStatusID: 4, ComplianceStatusID: 5, EnrollmentDate: '2023-09-29T05:39:21.877Z', CreatedOn: '2023-09-26T06:16:42.243Z', CustomerCode: 'rk', TunnelActive: 0, DisplayModel: 'Desktop', LocationGroupID: 12389 },
    { DeviceID: 9063, DeviceIdentifier: '485AEAFFF141BC44AE72A14589EED217', OEMInfo: 'Desktop', Platform: 'WinRT', OSMajorVersion: 10, OSMinorVersion: 0, OSBuildNumber: 19042, FriendlyName: 'krabish Desktop Windows Desktop 10.0.19042 0 96', SerialNumber: 'VMware-56 4d 2c 30 73 35 a4 a6-cf 4a 7a d0 92 70 c0 96', DeviceReportedName: 'DESKTOP-8SDF269', IsManaged: 1, EnrollmentStatusID: 4, ComplianceStatusID: 5, EnrollmentDate: '2023-10-02T07:03:17.467Z', CreatedOn: '2023-10-02T07:03:07.403Z', CustomerCode: 'rk', TunnelActive: 0, DisplayModel: 'Desktop', LocationGroupID: 12389 },
  ];
}

// ──── Device APIs ────
app.get('/api/devices', async (req, res) => {
  try {
    cachedDevices = await getDevicesFromDB();
    cachedDeviceDomains = loadOrBuildDeviceDomains(cachedDevices);
    res.json(cachedDevices);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/devices/:deviceId/domains', (req, res) => {
  if (!cachedDeviceDomains) return res.status(400).json({ error: 'Load devices first.' });
  const domains = cachedDeviceDomains[req.params.deviceId] || [];
  const blocked = readJSON('blockedDomains.json');
  const deviceBlocked = blocked[req.params.deviceId] || [];
  res.json(domains.map((d) => ({ ...d, isBlocked: deviceBlocked.includes(d.domain) })));
});

// ──── Analytics APIs ────
app.get('/api/analytics/top-domains', (req, res) => {
  if (!cachedDeviceDomains) return res.status(400).json({ error: 'No data loaded' });
  const counts = {};
  for (const devDomains of Object.values(cachedDeviceDomains)) {
    for (const e of devDomains) {
      if (!counts[e.domain]) counts[e.domain] = { domain: e.domain, totalVisits: 0, deviceCount: 0, isRedFlag: e.isRedFlag };
      counts[e.domain].totalVisits += e.visitCount;
      counts[e.domain].deviceCount += 1;
    }
  }
  res.json(Object.values(counts).sort((a, b) => b.totalVisits - a.totalVisits).slice(0, 20));
});

app.get('/api/analytics/redflag-domains', (req, res) => {
  if (!cachedDeviceDomains) return res.status(400).json({ error: 'No data loaded' });
  const rfList = readJSON('redFlagDomains.json');
  // Seed with every red-flag domain so the chart always shows all of them,
  // even if they currently have zero visits.
  const flagged = {};
  for (const d of rfList) flagged[d] = { domain: d, totalVisits: 0, devices: [] };

  for (const [deviceId, domains] of Object.entries(cachedDeviceDomains)) {
    for (const e of domains) {
      if (flagged[e.domain]) {
        flagged[e.domain].totalVisits += e.visitCount;
        flagged[e.domain].devices.push({ deviceId, visitCount: e.visitCount });
      }
    }
  }
  res.json(Object.values(flagged).sort((a, b) => b.totalVisits - a.totalVisits));
});

app.get('/api/analytics/all-domain-data', (req, res) => {
  if (!cachedDeviceDomains) return res.status(400).json({ error: 'No data loaded' });
  res.json(cachedDeviceDomains);
});

app.get('/api/analytics/browsing-categories', (req, res) => {
  if (!cachedDeviceDomains) return res.status(400).json({ error: 'No data loaded' });
  const categories = readJSON('domainCategories.json');
  const domainToCategory = {};
  for (const [cat, domains] of Object.entries(categories)) {
    for (const d of domains) domainToCategory[d] = cat;
  }
  const catVisits = {};
  const catDevices = {};
  for (const [deviceId, domains] of Object.entries(cachedDeviceDomains)) {
    for (const e of domains) {
      const cat = domainToCategory[e.domain] || 'Uncategorized';
      if (!catVisits[cat]) { catVisits[cat] = 0; catDevices[cat] = new Set(); }
      catVisits[cat] += e.visitCount;
      catDevices[cat].add(deviceId);
    }
  }
  const result = Object.entries(catVisits).map(([category, totalVisits]) => ({
    category,
    totalVisits,
    deviceCount: catDevices[category].size,
  })).sort((a, b) => b.totalVisits - a.totalVisits);
  res.json(result);
});

app.get('/api/analytics/domain-risk-scores', (req, res) => {
  if (!cachedDeviceDomains) return res.status(400).json({ error: 'No data loaded' });
  const rfList = readJSON('redFlagDomains.json');
  const perDevice = {};
  for (const [deviceId, domains] of Object.entries(cachedDeviceDomains)) {
    let totalVisits = 0, rfVisits = 0, rfCount = 0, uniqueDomains = domains.length;
    for (const e of domains) {
      totalVisits += e.visitCount;
      if (rfList.includes(e.domain)) { rfVisits += e.visitCount; rfCount++; }
    }
    const riskScore = Math.min(100, Math.round((rfVisits / Math.max(totalVisits, 1)) * 200 + rfCount * 8));
    const dev = cachedDevices.find((d) => d.DeviceIdentifier === deviceId);
    perDevice[deviceId] = {
      deviceId,
      deviceName: dev?.DeviceReportedName || dev?.FriendlyName || deviceId.slice(0, 12),
      riskScore,
      totalVisits,
      rfVisits,
      rfDomainCount: rfCount,
      uniqueDomains,
    };
  }
  res.json(Object.values(perDevice).sort((a, b) => b.riskScore - a.riskScore));
});

app.get('/api/analytics/hourly-traffic', (req, res) => {
  if (!cachedDeviceDomains) return res.status(400).json({ error: 'No data loaded' });
  const hours = Array.from({ length: 24 }, (_, i) => ({
    hour: `${String(i).padStart(2, '0')}:00`,
    safe: 0, flagged: 0,
  }));
  for (const domains of Object.values(cachedDeviceDomains)) {
    for (const e of domains) {
      const h = new Date(e.lastVisited).getHours();
      if (e.isRedFlag) hours[h].flagged += e.visitCount;
      else hours[h].safe += e.visitCount;
    }
  }
  res.json(hours);
});

app.get('/api/analytics/unique-domains-per-device', (req, res) => {
  if (!cachedDeviceDomains) return res.status(400).json({ error: 'No data loaded' });
  const result = [];
  for (const [deviceId, domains] of Object.entries(cachedDeviceDomains)) {
    const dev = cachedDevices.find((d) => d.DeviceIdentifier === deviceId);
    const safe = domains.filter((d) => !d.isRedFlag).length;
    const flagged = domains.filter((d) => d.isRedFlag).length;
    result.push({
      deviceName: dev?.DeviceReportedName || dev?.FriendlyName || deviceId.slice(0, 12),
      safe,
      flagged,
      total: safe + flagged,
    });
  }
  res.json(result.sort((a, b) => b.total - a.total));
});

// ──── Global Domain Block (rule-set scoped, NOT device scoped) ────
// External MDM API config — override via env if needed.
const EXTERNAL_BLOCK_API_BASE = process.env.EXTERNAL_BLOCK_API_BASE
  || 'https://snl.ssdevrd.com/API/mdm/tunnel/configuration-actions/device-traffic-rule-sets';
const EXTERNAL_BLOCK_OG_UUID = process.env.EXTERNAL_BLOCK_OG_UUID || '15269a42-de03-4b53-8c54-d12617118205';
const EXTERNAL_BLOCK_AUTH = process.env.EXTERNAL_BLOCK_AUTH || '';

// Browser triggers block: backend ONLY updates DB and returns the URL/params
// that the browser should POST to (the browser has the auth/session to hit
// the MDM API — backend does not).
app.post('/api/domains/block', async (req, res) => {
  const { domain, ruleSetId } = req.body || {};
  if (!domain || !ruleSetId) {
    return res.status(400).json({ success: false, error: 'domain and ruleSetId are required' });
  }

  const pattern = `*${domain}*`;
  let alreadyPresent = false;

  try {
    if (sqlUnavailable) {
      return res.status(503).json({ success: false, error: 'SQL Server unavailable — cannot update traffic rule.' });
    }
    const pool = await sql.connect(sqlConfig);

    // Check existing BLOCK destinations first — don't create duplicate *domain* entries.
    const existing = await pool.request()
      .input('ruleSetId', sql.UniqueIdentifier, ruleSetId)
      .query(`
        SELECT DestinationUrl FROM ws1tunnel.DeviceTrafficRule
        WHERE Action = 2 AND DeviceTrafficRuleSetUuid = @ruleSetId
      `);

    alreadyPresent = existing.recordset.some((row) => {
      const url = (row.DestinationUrl || '').toLowerCase();
      if (!url) return false;
      return url.split(',').map((p) => p.trim()).includes(pattern.toLowerCase());
    });

    if (alreadyPresent) {
      console.log(`[BLOCK] Skipping DB update — ${pattern} already exists for ruleSet ${ruleSetId}`);
    } else {
      const updateResult = await pool.request()
        .input('ruleSetId', sql.UniqueIdentifier, ruleSetId)
        .input('append', sql.NVarChar, `,${pattern}`)
        .query(`
          UPDATE ws1tunnel.DeviceTrafficRule
          SET DestinationUrl =
            CASE
              WHEN DestinationUrl IS NULL OR LEN(LTRIM(RTRIM(DestinationUrl))) = 0 THEN @append
              ELSE DestinationUrl + @append
            END
          WHERE Action = 2 AND DeviceTrafficRuleSetUuid = @ruleSetId
        `);
      console.log(`[BLOCK] DB updated ${updateResult.rowsAffected?.[0] || 0} row(s) for ruleSet ${ruleSetId}, added ${pattern}`);

      const versionResult = await pool.request()
        .input('ruleSetId', sql.UniqueIdentifier, ruleSetId)
        .query(`
          UPDATE ws1tunnel.DeviceTrafficRuleSet
          SET Version = Version + 1
          WHERE UuId = @ruleSetId
        `);
      console.log(`[BLOCK] Version bumped on ${versionResult.rowsAffected?.[0] || 0} rule-set row(s) for ${ruleSetId}`);
    }
  } catch (err) {
    console.error('[BLOCK] DB update failed:', err.message);
    return res.status(500).json({ success: false, error: `DB update failed: ${err.message}` });
  }

  const queryParams = {
    'tunnel-config-uuid': '',
    'og-uuid': EXTERNAL_BLOCK_OG_UUID,
    'dtr-set-uuid': ruleSetId.toString().toLowerCase(),
    'action': 'UPDATE',
    'publish-profile': 'false',
    'publish-safaridtr-profiles': 'false',
  };
  const externalUrl = `${EXTERNAL_BLOCK_API_BASE}?${new URLSearchParams(queryParams).toString()}`;

  return res.json({
    success: true,
    domain,
    ruleSetId,
    pattern,
    alreadyPresent,
    rowsAffected: undefined,
    externalCall: {
      method: 'POST',
      url: externalUrl,
      base: EXTERNAL_BLOCK_API_BASE,
      queryParams,
    },
  });
});

// Browser triggers unblock: backend removes the *domain* entry from the
// comma-separated DestinationUrl (handles leading/middle/trailing commas),
// bumps the rule-set Version, and returns the external MDM URL for the
// browser to POST to (same pattern as /api/domains/block).
app.post('/api/domains/unblock', async (req, res) => {
  const { domain, ruleSetId } = req.body || {};
  if (!domain || !ruleSetId) {
    return res.status(400).json({ success: false, error: 'domain and ruleSetId are required' });
  }

  const pattern = `*${domain}*`;
  const patternLower = pattern.toLowerCase();
  let removedFromAny = false;
  let totalRowsUpdated = 0;

  try {
    if (sqlUnavailable) {
      return res.status(503).json({ success: false, error: 'SQL Server unavailable — cannot update traffic rule.' });
    }
    const pool = await sql.connect(sqlConfig);

    const existing = await pool.request()
      .input('ruleSetId', sql.UniqueIdentifier, ruleSetId)
      .query(`
        SELECT UuId, DestinationUrl FROM ws1tunnel.DeviceTrafficRule
        WHERE Action = 2 AND DeviceTrafficRuleSetUuid = @ruleSetId
      `);

    for (const row of existing.recordset) {
      const current = row.DestinationUrl || '';
      if (!current) continue;
      const parts = current.split(',').map((p) => p.trim()).filter((p) => p.length > 0);
      const kept = parts.filter((p) => p.toLowerCase() !== patternLower);
      if (kept.length === parts.length) continue; // pattern not present in this row
      const updated = kept.join(',');
      const upd = await pool.request()
        .input('uuid', sql.UniqueIdentifier, row.UuId)
        .input('newUrl', sql.NVarChar, updated)
        .query(`
          UPDATE ws1tunnel.DeviceTrafficRule
          SET DestinationUrl = @newUrl
          WHERE UuId = @uuid
        `);
      totalRowsUpdated += upd.rowsAffected?.[0] || 0;
      removedFromAny = true;
    }

    if (!removedFromAny) {
      console.log(`[UNBLOCK] Pattern ${pattern} not found for ruleSet ${ruleSetId} — nothing to do`);
    } else {
      console.log(`[UNBLOCK] Removed ${pattern} from ${totalRowsUpdated} rule row(s) for ruleSet ${ruleSetId}`);
      const versionResult = await pool.request()
        .input('ruleSetId', sql.UniqueIdentifier, ruleSetId)
        .query(`
          UPDATE ws1tunnel.DeviceTrafficRuleSet
          SET Version = Version + 1
          WHERE UuId = @ruleSetId
        `);
      console.log(`[UNBLOCK] Version bumped on ${versionResult.rowsAffected?.[0] || 0} rule-set row(s) for ${ruleSetId}`);
    }
  } catch (err) {
    console.error('[UNBLOCK] DB update failed:', err.message);
    return res.status(500).json({ success: false, error: `DB update failed: ${err.message}` });
  }

  const queryParams = {
    'tunnel-config-uuid': '',
    'og-uuid': EXTERNAL_BLOCK_OG_UUID,
    'dtr-set-uuid': ruleSetId.toString().toLowerCase(),
    'action': 'UPDATE',
    'publish-profile': 'false',
    'publish-safaridtr-profiles': 'false',
  };
  const externalUrl = `${EXTERNAL_BLOCK_API_BASE}?${new URLSearchParams(queryParams).toString()}`;

  return res.json({
    success: true,
    domain,
    ruleSetId,
    pattern,
    removed: removedFromAny,
    rowsUpdated: totalRowsUpdated,
    externalCall: {
      method: 'POST',
      url: externalUrl,
      base: EXTERNAL_BLOCK_API_BASE,
      queryParams,
    },
  });
});

// ──── Block / Unblock (legacy per-device, kept for backward compat) ────
app.post('/api/devices/:deviceId/block', (req, res) => {
  const { domain } = req.body;
  const deviceId = req.params.deviceId;
  const blocked = readJSON('blockedDomains.json');
  if (!blocked[deviceId]) blocked[deviceId] = [];
  if (!blocked[deviceId].includes(domain)) blocked[deviceId].push(domain);
  writeJSON('blockedDomains.json', blocked);
  const dummyUrl = `https://tunnel-api.example.com/api/v1/devices/${deviceId}/domains/${encodeURIComponent(domain)}/block`;
  console.log(`[BLOCK] Would call: PUT ${dummyUrl}`);
  res.json({ success: true, action: 'blocked', domain, deviceId, apiUrl: dummyUrl });
});

app.post('/api/devices/:deviceId/unblock', (req, res) => {
  const { domain } = req.body;
  const deviceId = req.params.deviceId;
  const blocked = readJSON('blockedDomains.json');
  if (blocked[deviceId]) blocked[deviceId] = blocked[deviceId].filter((d) => d !== domain);
  writeJSON('blockedDomains.json', blocked);
  const dummyUrl = `https://tunnel-api.example.com/api/v1/devices/${deviceId}/domains/${encodeURIComponent(domain)}/unblock`;
  console.log(`[UNBLOCK] Would call: DELETE ${dummyUrl}`);
  res.json({ success: true, action: 'unblocked', domain, deviceId, apiUrl: dummyUrl });
});

// ──── Config ────
app.get('/api/config', (req, res) => res.json(readJSON('config.json')));
app.put('/api/config', (req, res) => { writeJSON('config.json', req.body); res.json({ success: true }); });
app.get('/api/blocked-domains', (req, res) => res.json(readJSON('blockedDomains.json')));
app.get('/api/redflag-reasons', (req, res) => res.json(readJSON('redFlagReasons.json')));
app.get('/api/domain-categories', (req, res) => res.json(readJSON('domainCategories.json')));

// ──── Data File CRUD (for Configuration page) ────
app.get('/api/data/master-domains', (req, res) => res.json(readJSON('masterDomains.json')));
app.put('/api/data/master-domains', (req, res) => { writeJSON('masterDomains.json', req.body); res.json({ success: true }); });

app.get('/api/data/redflag-domains', (req, res) => res.json(readJSON('redFlagDomains.json')));
app.put('/api/data/redflag-domains', (req, res) => { writeJSON('redFlagDomains.json', req.body); res.json({ success: true }); });

app.get('/api/data/redflag-reasons', (req, res) => res.json(readJSON('redFlagReasons.json')));
app.put('/api/data/redflag-reasons', (req, res) => { writeJSON('redFlagReasons.json', req.body); res.json({ success: true }); });

app.get('/api/data/domain-categories', (req, res) => res.json(readJSON('domainCategories.json')));
app.put('/api/data/domain-categories', (req, res) => { writeJSON('domainCategories.json', req.body); res.json({ success: true }); });

// ──── Traffic Rules (always live query, no fallback file) ────
app.get('/api/traffic-rules', async (req, res) => {
  if (sqlUnavailable) return res.json(readJSON('trafficRules.json'));
  try {
    const pool = await sql.connect(sqlConfig);
    const result = await pool.request().query(`
      SELECT 
        dtrs.UuId AS RuleSetId, dtrs.Name AS RuleSetName, dtrs.DefaultAction,
        dtrs.TunnelMode, dtrs.IsDefault, dtrs.Version,
        dtr.UuId AS RuleId, dtr.DestinationUrl, dtr.Action, dtr.RankOfRule,
        dtr.HttpsProxyServer, dtr.TunnelProxyAuthType,
        appMap.ApplicationId, winapp.FriendlyName, appMap.BundleId,
        dt.Name AS DeviceTypeName, appMap.DeviceTypeID, appMap.ApplicationType
      FROM ws1tunnel.DeviceTrafficRuleSet dtrs
      INNER JOIN ws1tunnel.DeviceTrafficRule dtr ON dtrs.UuId = dtr.DeviceTrafficRuleSetUuid
      LEFT JOIN ws1tunnel.TrafficRulesApplicationMapping appMap ON dtr.UuId = appMap.DeviceTrafficRuleUuid
      LEFT JOIN ws1tunnel.WindowsApplication winapp ON appMap.ApplicationId = winapp.UuId
      INNER JOIN dbo.DeviceType dt ON appMap.DeviceTypeID = dt.DeviceTypeID
      ORDER BY dtrs.UuId DESC
    `);
    res.json(result.recordset);
  } catch (err) {
    sqlUnavailable = true;
    if (!sqlFailureLogged) {
      console.warn('SQL Server traffic rules query failed, switching to fallback data mode:', err.message);
      sqlFailureLogged = true;
    }
    res.json(readJSON('trafficRules.json'));
  }
});

// ──── Refresh (applies incremental drift) ────
app.post('/api/refresh', async (req, res) => {
  cachedDevices = await getDevicesFromDB();
  cachedDeviceDomains = loadOrBuildDeviceDomains(cachedDevices);
  res.json({ success: true, deviceCount: cachedDevices.length });
});

// ──── Reset Chart Data (fresh generation, wipes snapshot) ────
app.post('/api/chart-data/reset', async (req, res) => {
  try {
    cachedDevices = await getDevicesFromDB();
    cachedDeviceDomains = generateDeviceDomains(cachedDevices);
    saveSnapshot(cachedDeviceDomains);
    res.json({ success: true, deviceCount: cachedDevices.length });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ──── App-Level Red Flag Domains ────
// Independent app-level traffic-rule scope. The rule-set UUID below is
// used as the target for INSERTs when an app+domain block is requested.
const APP_RULE_SET_UUID = process.env.APP_RULE_SET_UUID || 'B3DDC17D-C392-44F5-8089-08DEA43E0AEC';
const APP_RF_SNAPSHOT_FILE = 'appRedFlagsSnapshot.json';

// MDM v2 query API — used to fetch the AUTHORITATIVE per-app blocked-domain
// state straight from the MDM server (no DB roundtrip). Called from the
// backend so we don't expose admin credentials to the browser.
const TUNNEL_V2_LIST_URL = process.env.TUNNEL_V2_LIST_URL
  || 'https://snl.ssdevrd.com/API/mdm/tunnel/v2/device-traffic-rule-sets';
const TUNNEL_V2_OG_UUID = process.env.TUNNEL_V2_OG_UUID || EXTERNAL_BLOCK_OG_UUID;
const TUNNEL_V2_TENANT_CODE = process.env.TUNNEL_V2_TENANT_CODE
  || 'JC15W7uULCUWNFOnUmwxOEt/i8aN7tsiYjCyvdAYuus=';
const TUNNEL_V2_AUTH_USER = process.env.TUNNEL_V2_AUTH_USER || 'Administrator';
const TUNNEL_V2_AUTH_PASS = process.env.TUNNEL_V2_AUTH_PASS || 'airwatch1';

async function fetchAppLevelBlockedDomains() {
  const url = `${TUNNEL_V2_LIST_URL}?ogUuid=${TUNNEL_V2_OG_UUID}`;
  const auth = Buffer.from(`${TUNNEL_V2_AUTH_USER}:${TUNNEL_V2_AUTH_PASS}`).toString('base64');
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
      'aw-tenant-code': TUNNEL_V2_TENANT_CODE,
      'Authorization': `Basic ${auth}`,
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`MDM v2 list failed: ${res.status} ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  // Locate the rule-set dedicated to per-app blocking.
  const target = (data.items || []).find(
    (s) => (s.uuid || '').toLowerCase() === APP_RULE_SET_UUID.toLowerCase()
  );
  const byBundleId = {};
  const byApplicationUuid = {};
  const blockedRules = [];
  if (target) {
    for (const rule of target.traffic_rules || []) {
      if ((rule.action || '').toUpperCase() !== 'BLOCK') continue;
      const domains = rule.domains || [];
      const apps = rule.applications || [];
      blockedRules.push({
        ruleUuid: rule.uuid,
        domains,
        applications: apps.map((a) => ({
          uuid: a.uuid,
          bundleId: a.bundle_id,
          deviceType: a.device_type,
        })),
      });
      for (const a of apps) {
        const bid = (a.bundle_id || '').toLowerCase();
        const auid = (a.uuid || '').toLowerCase();
        if (bid) {
          if (!byBundleId[bid]) byBundleId[bid] = [];
          for (const d of domains) byBundleId[bid].push(d);
        }
        if (auid) {
          if (!byApplicationUuid[auid]) byApplicationUuid[auid] = [];
          for (const d of domains) byApplicationUuid[auid].push(d);
        }
      }
    }
  }
  return { byBundleId, byApplicationUuid, blockedRules, ruleSetUuid: APP_RULE_SET_UUID };
}

function getApplications() {
  try { return readJSON('applications.json'); } catch { return []; }
}

function loadAppRedFlagsSnapshot() {
  try { return readJSON(APP_RF_SNAPSHOT_FILE); } catch { return null; }
}

function saveAppRedFlagsSnapshot(data) {
  try { writeJSON(APP_RF_SNAPSHOT_FILE, data); }
  catch (err) { console.warn('Failed to save app RF snapshot:', err.message); }
}

function buildAppDomainStat(domain) {
  return {
    domain,
    totalVisits: Math.floor(Math.random() * 500) + 10,
    deviceCount: Math.floor(Math.random() * 8) + 1,
  };
}

// Generate a per-application red-flag map. Every configured app gets the
// FULL list of red-flag domains (just with its own per-app visit / device
// numbers) so the Take Action popup shows every domain for every app.
function generateAppRedFlagsSnapshot() {
  const apps = getApplications();
  const rfDomains = readJSON('redFlagDomains.json');
  const snapshot = {};
  for (const app of apps) {
    snapshot[app.applicationId] = rfDomains
      .map(buildAppDomainStat)
      .sort((a, b) => b.totalVisits - a.totalVisits);
  }
  return snapshot;
}

function loadOrBuildAppRedFlags() {
  const apps = getApplications();
  const rfDomains = readJSON('redFlagDomains.json');
  const existing = loadAppRedFlagsSnapshot();
  const reconciled = existing && typeof existing === 'object' ? { ...existing } : {};

  let mutated = false;
  for (const app of apps) {
    const current = Array.isArray(reconciled[app.applicationId]) ? reconciled[app.applicationId] : null;
    if (!current) {
      reconciled[app.applicationId] = rfDomains
        .map(buildAppDomainStat)
        .sort((a, b) => b.totalVisits - a.totalVisits);
      mutated = true;
      continue;
    }
    // Keep the visit/device numbers we already generated, but make sure
    // every red-flag domain is represented for this app.
    const have = new Set(current.map((x) => x.domain));
    const missing = rfDomains.filter((d) => !have.has(d));
    if (missing.length > 0) {
      const merged = [...current, ...missing.map(buildAppDomainStat)];
      reconciled[app.applicationId] = merged.sort((a, b) => b.totalVisits - a.totalVisits);
      mutated = true;
    }
  }

  if (mutated) saveAppRedFlagsSnapshot(reconciled);
  return reconciled;
}

// Authoritative per-app blocked domains, sourced from the MDM v2 query API.
// The frontend uses this to flip Block/Unblock labels in the per-app UI.
app.get('/api/applications/blocked-domains', async (req, res) => {
  try {
    const data = await fetchAppLevelBlockedDomains();
    res.json({ success: true, ...data });
  } catch (err) {
    console.warn('[APP-BLOCKED-LIST] failed:', err.message);
    res.status(502).json({
      success: false,
      error: err.message,
      byBundleId: {},
      byApplicationUuid: {},
      blockedRules: [],
      ruleSetUuid: APP_RULE_SET_UUID,
    });
  }
});

// Application list CRUD (configurable)
app.get('/api/data/applications', (req, res) => res.json(getApplications()));
app.put('/api/data/applications', (req, res) => {
  if (!Array.isArray(req.body)) return res.status(400).json({ success: false, error: 'Body must be an array of applications' });
  writeJSON('applications.json', req.body);
  res.json({ success: true });
});

// Per-application red-flag domains data
app.get('/api/analytics/app-redflag-domains', (req, res) => {
  const apps = getApplications();
  const snapshot = loadOrBuildAppRedFlags();
  const result = apps.map((app) => {
    const domains = snapshot[app.applicationId] || [];
    const totalVisits = domains.reduce((s, d) => s + d.totalVisits, 0);
    const totalDevices = domains.reduce((s, d) => s + (d.deviceCount || 0), 0);
    return {
      applicationId: app.applicationId,
      name: app.name,
      path: app.path,
      icon: app.icon || '',
      applicationType: app.applicationType ?? 0,
      deviceTypeId: app.deviceTypeId ?? 12,
      domains,
      totalVisits,
      domainCount: domains.length,
      totalDevices,
    };
  }).sort((a, b) => b.totalVisits - a.totalVisits);
  res.json(result);
});

// Reset / regenerate the per-app RF snapshot (used by Configuration page)
app.post('/api/applications/reset-redflag-data', (req, res) => {
  try {
    const fresh = generateAppRedFlagsSnapshot();
    saveAppRedFlagsSnapshot(fresh);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Helpers for managing the comma-separated DestinationUrl on the consolidated
// per-app BLOCK rule. The MDM stores blocked domains for an app as a CSV of
// `*domain*` tokens on a single DeviceTrafficRule row; we consolidate to one
// row per (rule-set, application) so block/unblock just edits this CSV.
function csvSplit(csv) {
  return (csv || '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
function csvJoin(tokens) {
  return tokens.join(',');
}
function wildcardToken(domain) {
  const trimmed = (domain || '').trim();
  if (!trimmed) return '';
  // If caller already supplied wildcards we keep them as-is; otherwise wrap.
  if (trimmed.startsWith('*') || trimmed.endsWith('*')) return trimmed;
  return `*${trimmed}*`;
}
function tokenMatchesDomain(token, domain) {
  // A token `*abc.xyz*` matches domain `abc.xyz`. Also tolerate manually
  // entered variants like `abc.xyz`, `*abc.xyz`, `abc.xyz*`.
  const stripped = (token || '').replace(/^\*+|\*+$/g, '').toLowerCase();
  return stripped === (domain || '').toLowerCase();
}

// App-level domain block. NOT shared with the system-level block API.
// Behaviour:
//   - If a BLOCK rule already exists for (RuleSet = APP_RULE_SET_UUID,
//     Action = 2) and is mapped to the requested application, we append
//     `*domain*` to that rule's DestinationUrl CSV (skipping if already
//     present) instead of inserting a new row.
//   - Otherwise we insert a brand-new BLOCK rule (DestinationUrl = `*domain*`)
//     and a TrafficRulesApplicationMapping row scoping it to this app.
// Either way we bump the rule-set Version. The browser caller is expected to
// publish via the returned external MDM URL.
app.post('/api/applications/block-domain', async (req, res) => {
  const { domain, applicationId } = req.body || {};
  if (!domain || !applicationId) {
    return res.status(400).json({ success: false, error: 'domain and applicationId are required' });
  }
  const apps = getApplications();
  const application = apps.find((a) => a.applicationId === applicationId);
  if (!application) {
    return res.status(404).json({ success: false, error: `Unknown application id: ${applicationId}` });
  }

  const ruleSetId = APP_RULE_SET_UUID;
  const token = wildcardToken(domain);
  let ruleUuid = null;
  let mappingUuid = null;
  let mode = null;
  let finalDestinationUrl = null;

  try {
    if (sqlUnavailable) {
      return res.status(503).json({ success: false, error: 'SQL Server unavailable — cannot insert app-level traffic rule.' });
    }
    const pool = await sql.connect(sqlConfig);

    // Look for an existing consolidated BLOCK rule for this (rule-set, app).
    const existing = await pool.request()
      .input('ruleSetId', sql.UniqueIdentifier, ruleSetId)
      .input('applicationId', sql.NVarChar, applicationId)
      .query(`
        SELECT TOP 1 dtr.UuId AS RuleUuId, dtr.DestinationUrl, m.UuId AS MappingUuId
        FROM ws1tunnel.DeviceTrafficRule dtr
        INNER JOIN ws1tunnel.TrafficRulesApplicationMapping m
          ON m.DeviceTrafficRuleUuid = dtr.UuId
        WHERE dtr.Action = 2
          AND dtr.DeviceTrafficRuleSetUuid = @ruleSetId
          AND m.ApplicationId = @applicationId
        ORDER BY dtr.RankOfRule
      `);

    if (existing.recordset.length > 0) {
      const row = existing.recordset[0];
      ruleUuid = row.RuleUuId;
      mappingUuid = row.MappingUuId;
      const tokens = csvSplit(row.DestinationUrl);
      const alreadyPresent = tokens.some((t) => tokenMatchesDomain(t, domain));
      if (alreadyPresent) {
        mode = 'noop-already-blocked';
        finalDestinationUrl = csvJoin(tokens);
        console.log(`[APP-BLOCK] ${domain} already present in rule ${ruleUuid} for app ${application.name}; no DB change`);
      } else {
        tokens.push(token);
        finalDestinationUrl = csvJoin(tokens);
        await pool.request()
          .input('ruleUuid', sql.UniqueIdentifier, ruleUuid)
          .input('dest', sql.NVarChar, finalDestinationUrl)
          .query(`
            UPDATE ws1tunnel.DeviceTrafficRule
            SET DestinationUrl = @dest
            WHERE UuId = @ruleUuid
          `);
        mode = 'appended';
        console.log(`[APP-BLOCK] Appended ${token} to rule ${ruleUuid} for app ${application.name}; CSV is now "${finalDestinationUrl}"`);
      }
    } else {
      ruleUuid = crypto.randomUUID();
      mappingUuid = crypto.randomUUID();
      finalDestinationUrl = token;

      await pool.request()
        .input('uuid', sql.UniqueIdentifier, ruleUuid)
        .input('dest', sql.NVarChar, finalDestinationUrl)
        .input('ruleSetId', sql.UniqueIdentifier, ruleSetId)
        .query(`
          INSERT INTO ws1tunnel.DeviceTrafficRule
            (UuId, Action, DestinationUrl, DeviceTrafficRuleSetUuid, HttpsProxyServer, RankOfRule, TunnelProxyAuthType)
          VALUES (@uuid, 2, @dest, @ruleSetId, NULL, 1, NULL)
        `);
      console.log(`[APP-BLOCK] Inserted DeviceTrafficRule ${ruleUuid} with DestinationUrl="${finalDestinationUrl}"`);

      await pool.request()
        .input('uuid', sql.UniqueIdentifier, mappingUuid)
        .input('applicationId', sql.NVarChar, application.applicationId)
        .input('applicationType', sql.Int, application.applicationType ?? 0)
        .input('bundleId', sql.NVarChar, application.path)
        .input('ruleUuid', sql.UniqueIdentifier, ruleUuid)
        .input('deviceTypeId', sql.Int, application.deviceTypeId ?? 12)
        .query(`
          INSERT INTO ws1tunnel.TrafficRulesApplicationMapping
            (UuId, ApplicationId, ApplicationType, BundleId, DeviceTrafficRuleUuid, DeviceTypeID)
          VALUES (@uuid, @applicationId, @applicationType, @bundleId, @ruleUuid, @deviceTypeId)
        `);
      console.log(`[APP-BLOCK] Inserted TrafficRulesApplicationMapping ${mappingUuid} for app ${application.name}`);
      mode = 'created';
    }

    if (mode !== 'noop-already-blocked') {
      const versionResult = await pool.request()
        .input('ruleSetId', sql.UniqueIdentifier, ruleSetId)
        .query(`
          UPDATE ws1tunnel.DeviceTrafficRuleSet
          SET Version = Version + 1
          WHERE UuId = @ruleSetId
        `);
      console.log(`[APP-BLOCK] Version bumped on ${versionResult.rowsAffected?.[0] || 0} rule-set row(s) for ${ruleSetId}`);
    }
  } catch (err) {
    console.error('[APP-BLOCK] DB op failed:', err.message);
    return res.status(500).json({ success: false, error: `DB op failed: ${err.message}` });
  }

  // Once the DB is updated, hit the MDM v2 query API to pull back the
  // current per-app blocked-domain state. This is best-effort — failure
  // here must not fail the block call (DB is already updated).
  let mdmState = null;
  let mdmStateError = null;
  try { mdmState = await fetchAppLevelBlockedDomains(); }
  catch (e) {
    mdmStateError = e.message;
    console.warn('[APP-BLOCK] post-update v2 fetch failed:', e.message);
  }

  const queryParams = {
    'tunnel-config-uuid': '',
    'og-uuid': EXTERNAL_BLOCK_OG_UUID,
    'dtr-set-uuid': ruleSetId.toString().toLowerCase(),
    'action': 'UPDATE',
    'publish-profile': 'false',
    'publish-safaridtr-profiles': 'false',
  };
  const externalUrl = `${EXTERNAL_BLOCK_API_BASE}?${new URLSearchParams(queryParams).toString()}`;

  return res.json({
    success: true,
    domain,
    applicationId,
    applicationName: application.name,
    applicationPath: application.path,
    ruleSetId,
    deviceTrafficRuleUuid: ruleUuid,
    mappingUuid,
    mode,
    destinationUrl: finalDestinationUrl,
    mdmState,
    mdmStateError,
    externalCall: {
      method: 'POST',
      url: externalUrl,
      base: EXTERNAL_BLOCK_API_BASE,
      queryParams,
    },
  });
});

// Per-app unblock. Behaviour:
//   - Find every BLOCK rule under the app-level rule-set that is mapped to
//     the requested application and whose CSV DestinationUrl contains a
//     token matching the domain (e.g. `*abc.xyz*`).
//   - Remove that token from the CSV (preserving the surrounding commas so
//     the remaining CSV is valid).
//   - Persist the new CSV. Only if the CSV becomes empty do we delete the
//     rule + its mappings (an empty DestinationUrl would be invalid).
//   - Bump the rule-set Version when anything changes.
app.post('/api/applications/unblock-domain', async (req, res) => {
  const { domain, applicationId } = req.body || {};
  if (!domain || !applicationId) {
    return res.status(400).json({ success: false, error: 'domain and applicationId are required' });
  }
  const apps = getApplications();
  const application = apps.find((a) => a.applicationId === applicationId);
  if (!application) {
    return res.status(404).json({ success: false, error: `Unknown application id: ${applicationId}` });
  }

  const ruleSetId = APP_RULE_SET_UUID;
  let updatedRules = 0;
  let removedMappings = 0;
  let removedRules = 0;
  const updatedDestinationUrls = [];

  try {
    if (sqlUnavailable) {
      return res.status(503).json({ success: false, error: 'SQL Server unavailable — cannot remove app-level traffic rule.' });
    }
    const pool = await sql.connect(sqlConfig);

    const found = await pool.request()
      .input('ruleSetId', sql.UniqueIdentifier, ruleSetId)
      .input('applicationId', sql.NVarChar, applicationId)
      .input('domainLike', sql.NVarChar, `%${domain.toLowerCase()}%`)
      .query(`
        SELECT DISTINCT dtr.UuId AS RuleUuId, dtr.DestinationUrl
        FROM ws1tunnel.TrafficRulesApplicationMapping m
        INNER JOIN ws1tunnel.DeviceTrafficRule dtr ON m.DeviceTrafficRuleUuid = dtr.UuId
        WHERE dtr.Action = 2
          AND dtr.DeviceTrafficRuleSetUuid = @ruleSetId
          AND m.ApplicationId = @applicationId
          AND LOWER(dtr.DestinationUrl) LIKE @domainLike
      `);

    for (const row of found.recordset) {
      const ruleUuid = row.RuleUuId;
      const tokens = csvSplit(row.DestinationUrl);
      const filtered = tokens.filter((t) => !tokenMatchesDomain(t, domain));

      if (filtered.length === tokens.length) {
        // No token actually matched (e.g. the LIKE caught a substring inside
        // some unrelated wildcard). Skip this rule.
        continue;
      }

      if (filtered.length === 0) {
        // CSV is now empty — DestinationUrl can't be blank, so clean up the
        // rule and any mappings pointing at it (only this one app should be
        // mapped to the per-app row, but we drop them all just in case).
        const delMaps = await pool.request()
          .input('ruleUuid', sql.UniqueIdentifier, ruleUuid)
          .query(`DELETE FROM ws1tunnel.TrafficRulesApplicationMapping WHERE DeviceTrafficRuleUuid = @ruleUuid`);
        removedMappings += delMaps.rowsAffected?.[0] || 0;

        const delRule = await pool.request()
          .input('ruleUuid', sql.UniqueIdentifier, ruleUuid)
          .query(`DELETE FROM ws1tunnel.DeviceTrafficRule WHERE UuId = @ruleUuid`);
        removedRules += delRule.rowsAffected?.[0] || 0;
        console.log(`[APP-UNBLOCK] Removed last token from rule ${ruleUuid}; deleted rule + mappings`);
      } else {
        const newCsv = csvJoin(filtered);
        await pool.request()
          .input('ruleUuid', sql.UniqueIdentifier, ruleUuid)
          .input('dest', sql.NVarChar, newCsv)
          .query(`
            UPDATE ws1tunnel.DeviceTrafficRule
            SET DestinationUrl = @dest
            WHERE UuId = @ruleUuid
          `);
        updatedRules += 1;
        updatedDestinationUrls.push({ ruleUuid, destinationUrl: newCsv });
        console.log(`[APP-UNBLOCK] Removed *${domain}* token from rule ${ruleUuid}; CSV is now "${newCsv}"`);
      }
    }

    if (updatedRules > 0 || removedRules > 0) {
      const versionResult = await pool.request()
        .input('ruleSetId', sql.UniqueIdentifier, ruleSetId)
        .query(`
          UPDATE ws1tunnel.DeviceTrafficRuleSet
          SET Version = Version + 1
          WHERE UuId = @ruleSetId
        `);
      console.log(`[APP-UNBLOCK] ${updatedRules} rule(s) updated, ${removedRules} rule(s) deleted, ${removedMappings} mapping(s) deleted; version bumped on ${versionResult.rowsAffected?.[0] || 0} rule-set row(s) for ${ruleSetId}`);
    } else {
      console.log(`[APP-UNBLOCK] Nothing to remove for app ${application.name} / domain ${domain}`);
    }
  } catch (err) {
    console.error('[APP-UNBLOCK] DB op failed:', err.message);
    return res.status(500).json({ success: false, error: `DB op failed: ${err.message}` });
  }

  let mdmState = null;
  let mdmStateError = null;
  try { mdmState = await fetchAppLevelBlockedDomains(); }
  catch (e) {
    mdmStateError = e.message;
    console.warn('[APP-UNBLOCK] post-update v2 fetch failed:', e.message);
  }

  const queryParams = {
    'tunnel-config-uuid': '',
    'og-uuid': EXTERNAL_BLOCK_OG_UUID,
    'dtr-set-uuid': ruleSetId.toString().toLowerCase(),
    'action': 'UPDATE',
    'publish-profile': 'false',
    'publish-safaridtr-profiles': 'false',
  };
  const externalUrl = `${EXTERNAL_BLOCK_API_BASE}?${new URLSearchParams(queryParams).toString()}`;

  return res.json({
    success: true,
    domain,
    applicationId,
    applicationName: application.name,
    applicationPath: application.path,
    ruleSetId,
    updatedRules,
    removedRules,
    removedMappings,
    updatedDestinationUrls,
    mdmState,
    mdmStateError,
    externalCall: {
      method: 'POST',
      url: externalUrl,
      base: EXTERNAL_BLOCK_API_BASE,
      queryParams,
    },
  });
});

const PORT = 3001;
app.listen(PORT, () => console.log(`TunnelSNL API server running on http://localhost:${PORT}`));
