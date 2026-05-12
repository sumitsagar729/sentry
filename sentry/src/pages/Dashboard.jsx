import { useState, useCallback, useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  PieChart, Pie, Cell, ResponsiveContainer,
  AreaChart, Area, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  Treemap,
} from 'recharts';
import { useApp } from '../context/AppContext';
import ConfirmModal from '../components/ConfirmModal';
import './Dashboard.css';

const COLORS = ['#1976d2', '#00897b', '#7b1fa2', '#ef6c00', '#c62828', '#2e7d32', '#5c6bc0', '#00acc1', '#8d6e63', '#78909c', '#e91e63', '#009688', '#ff5722', '#3f51b5', '#795548', '#607d8b'];
const RED_FLAG_COLORS = ['#c62828', '#d32f2f', '#e53935', '#ef5350', '#f44336', '#ff5252', '#ff1744', '#b71c1c', '#880e4f', '#ad1457'];
const APP_RED_FLAG_COLORS = [
  '#c62828', // red 800
  '#d84315', // deep orange 800
  '#ef6c00', // orange 800
  '#ad1457', // pink 800
  '#6a1b9a', // purple 800
  '#4527a0', // deep purple 800
  '#283593', // indigo 800
  '#b71c1c', // red 900
  '#bf360c', // deep orange 900
  '#e64a19', // deep orange 600
  '#f4511e', // deep orange 500
  '#e53935', // red 600
  '#ec407a', // pink 400
  '#ab47bc', // purple 400
  '#8e24aa', // purple 600
  '#5d4037', // brown 700
  '#ff7043', // deep orange 400
  '#d81b60', // pink 600
  '#7b1fa2', // purple 700
  '#ff5252', // red A200
];
const ACTION_MAP = { 1: 'TUNNEL', 2: 'BLOCK', 3: 'BYPASS' };
const ACTION_CLASS = { 1: 'badge-blue', 2: 'badge-red', 3: 'badge-orange' };
const APP_RF_CHART_SETTINGS_KEY = 'tunnelsnl.appRedFlagChartSettings.v1';
const DEFAULT_APP_RF_CHART_SETTINGS = {
  layout: 'vertical', // recharts: 'vertical' = horizontal bars, 'horizontal' = vertical bars
  widthPct: 100,
  height: 380,
  barSize: 18,
  yAxisWidth: 160,
  fontSize: 11,
  maxItems: 10,
};

function loadAppRfChartSettings() {
  if (typeof window === 'undefined') return DEFAULT_APP_RF_CHART_SETTINGS;
  try {
    const raw = window.localStorage.getItem(APP_RF_CHART_SETTINGS_KEY);
    if (!raw) return DEFAULT_APP_RF_CHART_SETTINGS;
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_APP_RF_CHART_SETTINGS, ...(parsed && typeof parsed === 'object' ? parsed : {}) };
  } catch {
    return DEFAULT_APP_RF_CHART_SETTINGS;
  }
}
// Rule-set UUID dedicated to app-level blocking. App-level "Blocked" status
// is computed ONLY against rules in this set so it is fully isolated from
// system-level blocks (which live in different rule-sets).
const APP_RULE_SET_UUID = 'B3DDC17D-C392-44F5-8089-08DEA43E0AEC';

function CustomTreemapContent({ x, y, width, height, name, value, index }) {
  if (width < 40 || height < 30) return null;
  return (
    <g>
      <rect x={x} y={y} width={width} height={height} rx={4} fill={COLORS[index % COLORS.length]} stroke="#fff" strokeWidth={2} />
      {width > 60 && height > 40 && (
        <>
          <text x={x + 6} y={y + 16} fill="#fff" fontSize={11} fontWeight={600}>{name?.length > 18 ? name.slice(0, 16) + '…' : name}</text>
          <text x={x + 6} y={y + 30} fill="rgba(255,255,255,0.8)" fontSize={10}>{value?.toLocaleString()} visits</text>
        </>
      )}
    </g>
  );
}

export default function Dashboard() {
  const {
    devices, config, topDomains, redFlagDomains, allDomainData,
    trafficRules, trafficRulesError, trafficRulesLoading, redFlagReasons,
    browsingCategories, riskScores, hourlyTraffic, domainsPerDevice, domainCategoriesMap,
    appRedFlagDomains, appBlockedDomains,
    loading, error, blockDomain, unblockDomain, getDeviceDomains, fetchTrafficRules, showNotification,
    blockDomainForApp, unblockDomainForApp, fetchAppRedFlagDomains, fetchAppBlockedDomains,
  } = useApp();

  const [blockedDomains, setBlockedDomains] = useState(() => new Set());

  const [selectedDevice, setSelectedDevice] = useState(null);
  const [deviceDomains, setDeviceDomains] = useState([]);
  const [detailView, setDetailView] = useState(null);
  const [confirmModal, setConfirmModal] = useState(null);
  const [domainDeviceDetail, setDomainDeviceDetail] = useState(null);
  const [loadingDomains, setLoadingDomains] = useState(false);
  const [redFlagActionPanel, setRedFlagActionPanel] = useState(false);
  const [redFlagActionSearch, setRedFlagActionSearch] = useState('');
  const [redFlagReasonsPopup, setRedFlagReasonsPopup] = useState(null);
  const [trafficRulesPopup, setTrafficRulesPopup] = useState(false);
  const [topDomainsPopup, setTopDomainsPopup] = useState(false);
  const [topDomainsSearch, setTopDomainsSearch] = useState('');
  const [categoriesPopup, setCategoriesPopup] = useState(false);
  const [categoriesSearch, setCategoriesSearch] = useState('');
  const [riskScoresPopup, setRiskScoresPopup] = useState(false);
  const [riskScoresSearch, setRiskScoresSearch] = useState('');
  const [hourlyTrafficPopup, setHourlyTrafficPopup] = useState(false);
  const [domainsPerDevicePopup, setDomainsPerDevicePopup] = useState(false);
  const [domainsPerDeviceSearch, setDomainsPerDeviceSearch] = useState('');
  const [appRedFlagPanel, setAppRedFlagPanel] = useState(false);
  const [appRedFlagSearch, setAppRedFlagSearch] = useState('');
  const [appRedFlagSelected, setAppRedFlagSelected] = useState(null);
  const [appBlockedKeys, setAppBlockedKeys] = useState(() => new Set());
  const [appUnblockedKeys, setAppUnblockedKeys] = useState(() => new Set());
  const [appRfSettingsOpen, setAppRfSettingsOpen] = useState(false);
  const [appRfChartSettings, setAppRfChartSettings] = useState(loadAppRfChartSettings);

  const updateAppRfChartSetting = useCallback((key, value) => {
    setAppRfChartSettings((prev) => {
      const next = { ...prev, [key]: value };
      try { window.localStorage.setItem(APP_RF_CHART_SETTINGS_KEY, JSON.stringify(next)); } catch { /* ignore quota */ }
      return next;
    });
  }, []);

  const resetAppRfChartSettings = useCallback(() => {
    try { window.localStorage.removeItem(APP_RF_CHART_SETTINGS_KEY); } catch { /* ignore */ }
    setAppRfChartSettings(DEFAULT_APP_RF_CHART_SETTINGS);
  }, []);

  const graphConfig = config?.graphs || {};
  const messages = config?.messages || {};

  const osBuildData = useMemo(() => {
    const c = {};
    devices.forEach((d) => { const b = `${d.OSMajorVersion || 10}.${d.OSMinorVersion || 0}.${d.OSBuildNumber || 'N/A'}`; c[b] = (c[b] || 0) + 1; });
    return Object.entries(c).map(([build, count]) => ({ build, count }));
  }, [devices]);

  const enrollmentTimeline = useMemo(() => {
    const m = {};
    devices.forEach((d) => { if (d.EnrollmentDate) { const dt = new Date(d.EnrollmentDate); const k = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`; m[k] = (m[k] || 0) + 1; } });
    return Object.entries(m).sort().map(([month, count]) => ({ month, count }));
  }, [devices]);

  const managedPieData = useMemo(() => {
    let mg = 0, um = 0;
    devices.forEach((d) => { d.IsManaged === 1 || d.IsManaged === true ? mg++ : um++; });
    return [{ name: 'Managed', value: mg }, { name: 'Unmanaged', value: um }];
  }, [devices]);

  const compliancePieData = useMemo(() => {
    const s = {};
    devices.forEach((d) => { const k = d.ComplianceStatusID === 5 ? 'Compliant' : d.ComplianceStatusID === 4 ? 'Non-Compliant' : `Status ${d.ComplianceStatusID || 'Unknown'}`; s[k] = (s[k] || 0) + 1; });
    return Object.entries(s).map(([name, value]) => ({ name, value }));
  }, [devices]);

  const treemapData = useMemo(() => browsingCategories.map((c) => ({ name: c.category, value: c.totalVisits, deviceCount: c.deviceCount })), [browsingCategories]);

  const groupedTrafficRules = useMemo(() => {
    const g = {};
    for (const r of trafficRules) { const k = r.RuleSetId; if (!g[k]) g[k] = { ruleSetId: r.RuleSetId, ruleSetName: r.RuleSetName, defaultAction: r.DefaultAction, tunnelMode: r.TunnelMode, version: r.Version, rules: [] }; g[k].rules.push(r); }
    return Object.values(g);
  }, [trafficRules]);

  // Collect every destination pattern currently configured with BLOCK (Action=2)
  // in SYSTEM-level rule-sets. Rules that live in the dedicated app-level
  // rule-set are intentionally skipped so app-scoped blocks never leak into
  // the system-level "Blocked" indicator.
  const existingBlockPatterns = useMemo(() => {
    const appRuleSetId = APP_RULE_SET_UUID.toLowerCase();
    const patterns = [];
    for (const r of trafficRules) {
      if (r.Action !== 2 || !r.DestinationUrl) continue;
      if ((r.RuleSetId || '').toLowerCase() === appRuleSetId) continue;
      for (const raw of String(r.DestinationUrl).split(',')) {
        const p = raw.trim().toLowerCase();
        if (p) patterns.push(p);
      }
    }
    return patterns;
  }, [trafficRules]);

  const isDomainBlocked = useCallback((domain) => {
    if (!domain) return false;
    if (blockedDomains.has(domain)) return true;
    const d = domain.toLowerCase();
    const exact = `*${d}*`;
    for (const p of existingBlockPatterns) {
      if (p === exact) return true;
      // Also treat "*foo.com*" as a match when the stripped token is contained in the domain
      const stripped = p.replace(/\*/g, '');
      if (stripped && d.includes(stripped)) return true;
    }
    return false;
  }, [blockedDomains, existingBlockPatterns]);

  const appRedFlagChartData = useMemo(() => {
    return (appRedFlagDomains || []).map((a) => ({
      ...a,
      label: `${a.icon ? a.icon + ' ' : ''}${a.name}`,
    }));
  }, [appRedFlagDomains]);

  // Build per-app pie data for Firefox & OpenClaw AI: top 5 visited
  // (red-flagged) domains + an "Other" slice aggregating the rest.
  const appDomainPies = useMemo(() => {
    const list = appRedFlagDomains || [];
    const targets = [
      { match: (n) => /firefox/i.test(n) },
      { match: (n) => /openclaw/i.test(n) },
    ];
    return targets
      .map((t) => list.find((a) => t.match(a.name || '')))
      .filter(Boolean)
      .map((app) => {
        const sorted = [...(app.domains || [])].sort((a, b) => b.totalVisits - a.totalVisits);
        const top = sorted.slice(0, 5).map((d) => ({ name: d.domain, value: d.totalVisits }));
        const otherSum = sorted.slice(5).reduce((s, d) => s + (d.totalVisits || 0), 0);
        const data = otherSum > 0 ? [...top, { name: 'Other', value: otherSum }] : top;
        return { app, data };
      });
  }, [appRedFlagDomains]);

  const defaultAppRedFlagId = useMemo(() => {
    const list = appRedFlagDomains || [];
    const openClaw = list.find((a) => (a.name || '').toLowerCase().includes('openclaw'));
    return openClaw?.applicationId || list[0]?.applicationId || null;
  }, [appRedFlagDomains]);

  const openAppRedFlagPanel = useCallback((appId) => {
    setAppRedFlagSelected(appId ?? defaultAppRedFlagId);
    setAppRedFlagPanel(true);
  }, [defaultAppRedFlagId]);

  const filteredAppRedFlag = useMemo(() => {
    const q = appRedFlagSearch.trim().toLowerCase();
    let list = appRedFlagDomains || [];
    if (appRedFlagSelected) list = list.filter((a) => a.applicationId === appRedFlagSelected);
    if (!q) return list;
    return list
      .map((a) => ({ ...a, domains: (a.domains || []).filter((d) => d.domain.toLowerCase().includes(q)) }))
      .filter((a) => a.name.toLowerCase().includes(q) || a.domains.length > 0);
  }, [appRedFlagDomains, appRedFlagSearch, appRedFlagSelected]);

  const handleAppBlock = useCallback((domain, application) => {
    if (!application?.applicationId) {
      showNotification('Cannot block: missing application id.', 'error');
      return;
    }
    setConfirmModal({
      title: 'Block Domain for Application',
      message: messages.appBlockConfirm
        || `Block ${domain} only for ${application.name}? A new app-scoped traffic rule will be created and published.`,
      danger: true,
      confirmLabel: 'Block',
      loadingLabel: 'Blocking…',
      loadingMessage: `Inserting app-scoped block rule for ${application.name} and publishing to MDM server…`,
      loading: false,
      onConfirm: async () => {
        setConfirmModal((prev) => (prev ? { ...prev, loading: true } : prev));
        const ok = await blockDomainForApp(domain, application.applicationId);
        if (ok) {
          const key = `${application.applicationId}::${domain.toLowerCase()}`;
          setAppBlockedKeys((prev) => { const n = new Set(prev); n.add(key); return n; });
          setAppUnblockedKeys((prev) => { const n = new Set(prev); n.delete(key); return n; });
          fetchTrafficRules();
        }
        setConfirmModal(null);
      },
    });
  }, [messages, blockDomainForApp, fetchTrafficRules, showNotification]);

  const handleAppUnblock = useCallback((domain, application) => {
    if (!application?.applicationId) {
      showNotification('Cannot unblock: missing application id.', 'error');
      return;
    }
    setConfirmModal({
      title: 'Unblock Domain for Application',
      message: messages.appUnblockConfirm
        || `Unblock ${domain} for ${application.name}? The app-scoped traffic rule will be removed and republished.`,
      danger: false,
      confirmLabel: 'Unblock',
      loadingLabel: 'Unblocking…',
      loadingMessage: `Removing app-scoped block rule for ${application.name} and publishing to MDM server…`,
      loading: false,
      onConfirm: async () => {
        setConfirmModal((prev) => (prev ? { ...prev, loading: true } : prev));
        const ok = await unblockDomainForApp(domain, application.applicationId);
        if (ok) {
          const key = `${application.applicationId}::${domain.toLowerCase()}`;
          setAppUnblockedKeys((prev) => { const n = new Set(prev); n.add(key); return n; });
          setAppBlockedKeys((prev) => { const n = new Set(prev); n.delete(key); return n; });
          fetchTrafficRules();
        }
        setConfirmModal(null);
      },
    });
  }, [messages, unblockDomainForApp, fetchTrafficRules, showNotification]);

  const isAppDomainBlocked = useCallback((applicationId, domain, applicationPath) => {
    if (!applicationId || !domain) return false;
    const key = `${applicationId}::${domain.toLowerCase()}`;
    if (appUnblockedKeys.has(key)) return false;
    if (appBlockedKeys.has(key)) return true;
    const d = domain.toLowerCase();

    // Authoritative source: MDM v2 query response (fetched from backend).
    const bid = (applicationPath || '').toLowerCase();
    const patterns = bid ? (appBlockedDomains?.byBundleId?.[bid] || []) : [];
    for (const pat of patterns) {
      const tok = (pat || '').toLowerCase().replace(/\*/g, '').trim();
      if (!tok) continue;
      if (tok === d || d.includes(tok) || tok.includes(d)) return true;
    }

    // Fallback: rules in the dedicated app rule-set from the local DB query.
    const appRuleSetId = APP_RULE_SET_UUID.toLowerCase();
    for (const r of trafficRules) {
      if (r.Action !== 2) continue;
      if ((r.RuleSetId || '').toLowerCase() !== appRuleSetId) continue;
      if ((r.ApplicationId || '').toLowerCase() !== applicationId.toLowerCase()) continue;
      const dest = (r.DestinationUrl || '').toLowerCase();
      if (!dest) continue;
      const tokens = dest.split(',').map((t) => t.trim().replace(/\*/g, '')).filter(Boolean);
      if (tokens.some((t) => t === d || d.includes(t))) return true;
    }
    return false;
  }, [appBlockedKeys, appUnblockedKeys, appBlockedDomains, trafficRules]);

  const allRedFlagForAction = useMemo(() => {
    return redFlagDomains.map((rf) => ({
      domain: rf.domain,
      totalVisits: rf.totalVisits,
      deviceCount: rf.devices?.length || 0,
    }));
  }, [redFlagDomains]);

  const filteredRedFlagAction = useMemo(() => {
    const q = redFlagActionSearch.trim().toLowerCase();
    if (!q) return allRedFlagForAction;
    return allRedFlagForAction.filter((r) => r.domain.toLowerCase().includes(q));
  }, [allRedFlagForAction, redFlagActionSearch]);

  const allDomainsAggregated = useMemo(() => {
    const counts = {};
    for (const [deviceId, domains] of Object.entries(allDomainData)) {
      for (const e of domains) {
        if (!counts[e.domain]) counts[e.domain] = { domain: e.domain, totalVisits: 0, deviceCount: 0, isRedFlag: e.isRedFlag, deviceIds: new Set() };
        counts[e.domain].totalVisits += e.visitCount;
        counts[e.domain].deviceIds.add(deviceId);
        counts[e.domain].isRedFlag = counts[e.domain].isRedFlag || e.isRedFlag;
      }
    }
    return Object.values(counts).map((c) => ({ ...c, deviceCount: c.deviceIds.size })).sort((a, b) => b.totalVisits - a.totalVisits);
  }, [allDomainData]);

  const filteredTopDomains = useMemo(() => {
    const q = topDomainsSearch.trim().toLowerCase();
    if (!q) return allDomainsAggregated;
    return allDomainsAggregated.filter((d) => d.domain.toLowerCase().includes(q));
  }, [allDomainsAggregated, topDomainsSearch]);

  const categoriesDetailed = useMemo(() => {
    const q = categoriesSearch.trim().toLowerCase();
    const withDomains = browsingCategories.map((c) => {
      const listedDomains = domainCategoriesMap[c.category] || [];
      const activeDomainStats = {};
      for (const devDomains of Object.values(allDomainData)) {
        for (const e of devDomains) {
          if (listedDomains.includes(e.domain)) {
            activeDomainStats[e.domain] = (activeDomainStats[e.domain] || 0) + e.visitCount;
          }
        }
      }
      const domainsWithVisits = Object.entries(activeDomainStats).map(([d, v]) => ({ domain: d, visits: v })).sort((a, b) => b.visits - a.visits);
      return { ...c, domains: domainsWithVisits };
    });
    if (!q) return withDomains;
    return withDomains
      .map((c) => ({ ...c, domains: c.domains.filter((d) => d.domain.toLowerCase().includes(q)) }))
      .filter((c) => c.category.toLowerCase().includes(q) || c.domains.length > 0);
  }, [browsingCategories, domainCategoriesMap, allDomainData, categoriesSearch]);

  const riskScoresDetailed = useMemo(() => {
    const rfDomainSet = new Set(redFlagDomains.map((r) => r.domain));
    return riskScores.map((r) => {
      const devDomains = allDomainData[r.deviceId] || [];
      const topFlagged = devDomains
        .filter((d) => rfDomainSet.has(d.domain))
        .sort((a, b) => b.visitCount - a.visitCount)
        .slice(0, 3)
        .map((d) => ({ domain: d.domain, visits: d.visitCount }));
      const pctFlagged = r.totalVisits > 0 ? Math.round((r.rfVisits / r.totalVisits) * 100) : 0;
      const severity = r.riskScore >= 60 ? 'High' : r.riskScore >= 30 ? 'Medium' : 'Low';
      const factors = [];
      if (r.rfDomainCount > 0) factors.push(`${r.rfDomainCount} flagged domain${r.rfDomainCount === 1 ? '' : 's'} visited`);
      if (pctFlagged > 0) factors.push(`${pctFlagged}% of visits went to flagged destinations`);
      if (r.rfVisits > 0) factors.push(`${r.rfVisits.toLocaleString()} flagged visits of ${r.totalVisits.toLocaleString()} total`);
      if (factors.length === 0) factors.push('No flagged activity detected');
      return { ...r, pctFlagged, severity, topFlagged, factors };
    });
  }, [riskScores, allDomainData, redFlagDomains]);

  const filteredRiskScores = useMemo(() => {
    const q = riskScoresSearch.trim().toLowerCase();
    if (!q) return riskScoresDetailed;
    return riskScoresDetailed.filter((r) => r.deviceName.toLowerCase().includes(q));
  }, [riskScoresDetailed, riskScoresSearch]);

  const hourlyTrafficDetailed = useMemo(() => {
    const total = hourlyTraffic.reduce((acc, h) => ({ safe: acc.safe + h.safe, flagged: acc.flagged + h.flagged }), { safe: 0, flagged: 0 });
    const withPct = hourlyTraffic.map((h) => { const t = h.safe + h.flagged; return { ...h, total: t, flaggedPct: t > 0 ? Math.round((h.flagged / t) * 100) : 0 }; });
    const peak = withPct.reduce((a, b) => (b.total > (a?.total || 0) ? b : a), null);
    const peakFlagged = withPct.reduce((a, b) => (b.flagged > (a?.flagged || 0) ? b : a), null);
    return { hours: withPct, total, peak, peakFlagged };
  }, [hourlyTraffic]);

  const filteredDomainsPerDevice = useMemo(() => {
    const q = domainsPerDeviceSearch.trim().toLowerCase();
    if (!q) return domainsPerDevice;
    return domainsPerDevice.filter((d) => d.deviceName.toLowerCase().includes(q));
  }, [domainsPerDevice, domainsPerDeviceSearch]);

  const handleDeviceBarClick = useCallback((data) => {
    if (!data?.activePayload?.[0]) return;
    const build = data.activePayload[0].payload.build;
    const match = devices.filter((d) => `${d.OSMajorVersion || 10}.${d.OSMinorVersion || 0}.${d.OSBuildNumber || 'N/A'}` === build);
    if (match.length > 0) { setDetailView('device-list'); setSelectedDevice(null); setDeviceDomains(match); showNotification(messages.deviceClickInfo || 'Click a device to see its domains', 'info'); }
  }, [devices, messages, showNotification]);

  const handleDeviceSelect = useCallback(async (device) => {
    setLoadingDomains(true); setSelectedDevice(device);
    try { const d = await getDeviceDomains(device.DeviceIdentifier); setDeviceDomains(d); setDetailView('device-domains'); }
    catch { showNotification('Failed to load domain data', 'error'); }
    finally { setLoadingDomains(false); }
  }, [getDeviceDomains, showNotification]);

  const handleDomainBarClick = useCallback((data) => {
    if (!data?.activePayload?.[0]) return;
    const domain = data.activePayload[0].payload.domain;
    const dv = [];
    for (const [deviceId, domains] of Object.entries(allDomainData)) { const e = domains.find((d) => d.domain === domain); if (e) { const dev = devices.find((d) => d.DeviceIdentifier === deviceId); dv.push({ deviceId, deviceName: dev?.DeviceReportedName || dev?.FriendlyName || deviceId.slice(0, 12), visitCount: e.visitCount, lastVisited: e.lastVisited, isBlocked: e.isBlocked }); } }
    setDomainDeviceDetail({ domain, devices: dv }); setDetailView('domain-devices'); showNotification(messages.domainClickInfo || 'Showing devices that visited this domain', 'info');
  }, [allDomainData, devices, messages, showNotification]);

  const primaryRuleSetId = useMemo(() => {
    if (!trafficRules?.length) return null;
    const nonDefault = trafficRules.find((r) => !r.IsDefault);
    return (nonDefault || trafficRules[0]).RuleSetId;
  }, [trafficRules]);

  const handleBlock = useCallback((domain) => {
    if (!primaryRuleSetId) {
      showNotification('No traffic rule set available to block against. Ensure traffic rules are loaded.', 'error');
      return;
    }
    setConfirmModal({
      title: 'Block Domain',
      message: messages.blockConfirm || `Block ${domain}?`,
      danger: true,
      confirmLabel: 'Block',
      loadingLabel: 'Blocking…',
      loadingMessage: 'Updating traffic rule and publishing to MDM server. Please wait…',
      loading: false,
      onConfirm: async () => {
        setConfirmModal((prev) => (prev ? { ...prev, loading: true } : prev));
        const ok = await blockDomain(domain, primaryRuleSetId);
        if (ok) {
          setBlockedDomains((prev) => { const n = new Set(prev); n.add(domain); return n; });
          fetchTrafficRules();
        }
        setConfirmModal(null);
      },
    });
  }, [messages, blockDomain, primaryRuleSetId, showNotification, fetchTrafficRules]);

  const handleUnblock = useCallback((domain) => {
    if (!primaryRuleSetId) {
      showNotification('No traffic rule set available to update. Ensure traffic rules are loaded.', 'error');
      return;
    }
    setConfirmModal({
      title: 'Unblock Domain',
      message: messages.unblockConfirm || `Unblock ${domain}?`,
      danger: false,
      confirmLabel: 'Unblock',
      loadingLabel: 'Unblocking…',
      loadingMessage: 'Updating traffic rule and publishing to MDM server. Please wait…',
      loading: false,
      onConfirm: async () => {
        setConfirmModal((prev) => (prev ? { ...prev, loading: true } : prev));
        const ok = await unblockDomain(domain, primaryRuleSetId);
        if (ok) {
          setBlockedDomains((prev) => { const n = new Set(prev); n.delete(domain); return n; });
          fetchTrafficRules();
        }
        setConfirmModal(null);
      },
    });
  }, [messages, unblockDomain, primaryRuleSetId, showNotification, fetchTrafficRules]);

  const closeDetail = () => { setDetailView(null); setSelectedDevice(null); setDeviceDomains([]); setDomainDeviceDetail(null); };

  if (loading) return <div className="dashboard-loading"><div className="spinner" /><p>{messages.loadingData || 'Loading analytics data...'}</p></div>;
  if (error) return <div className="dashboard-error"><p>Error: {error}</p><p>Make sure the backend server is running on port 3001.</p></div>;

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <h2>Tunnel Analytics Dashboard</h2>
        <select className="platform-dropdown"><option value="Windows">Windows</option></select>
        <span className="device-count-badge">{devices.length} WinRT Devices</span>
        <button className="btn-sm btn-outline" onClick={() => { setTrafficRulesPopup(true); fetchTrafficRules(); }}>Device Traffic Rules</button>
      </div>

      {detailView && (
        <div className="detail-panel">
          <div className="detail-panel-header">
            <h3>
              {detailView === 'device-list' && 'Devices in Selected Build'}
              {detailView === 'device-domains' && `Domain Activity — ${selectedDevice?.DeviceReportedName || selectedDevice?.FriendlyName}`}
              {detailView === 'domain-devices' && (<>Devices visiting <span className={domainDeviceDetail?.isRedFlag ? 'red-flag-text' : ''}>{domainDeviceDetail?.domain}</span></>)}
            </h3>
            <button className="detail-close" onClick={closeDetail}>✕</button>
          </div>
          <div className="detail-table-wrap">
            {loadingDomains ? <div className="dashboard-loading"><div className="spinner" /></div>
            : detailView === 'device-list' ? (
              <table className="detail-table"><thead><tr><th>Device Name</th><th>OS Build</th><th>Serial</th><th>Managed</th><th>Enrollment</th><th>Action</th></tr></thead><tbody>
                {deviceDomains.map((d) => (<tr key={d.DeviceID || d.DeviceIdentifier}><td className="clickable" onClick={() => handleDeviceSelect(d)}>{d.DeviceReportedName || d.FriendlyName}</td><td>{d.OSMajorVersion || 10}.{d.OSMinorVersion || 0}.{d.OSBuildNumber}</td><td className="mono">{(d.SerialNumber || '').slice(0, 20)}</td><td><span className={`badge ${d.IsManaged ? 'badge-green' : 'badge-orange'}`}>{d.IsManaged ? 'Yes' : 'No'}</span></td><td>{d.EnrollmentDate ? new Date(d.EnrollmentDate).toLocaleDateString() : 'N/A'}</td><td><button className="btn-sm btn-primary" onClick={() => handleDeviceSelect(d)}>View Domains</button></td></tr>))}
              </tbody></table>
            ) : detailView === 'device-domains' ? (
              <table className="detail-table"><thead><tr><th>Domain</th><th>Visits</th><th>Last Visited</th><th>Action</th></tr></thead><tbody>
                {[...deviceDomains].sort((a, b) => b.visitCount - a.visitCount).map((d) => {
                  const isBlocked = isDomainBlocked(d.domain);
                  return (
                    <tr key={d.domain} className={d.isRedFlag ? 'row-redflag' : ''}>
                      <td>{d.isRedFlag && <span className="redflag-icon">⚠</span>}{d.domain}</td>
                      <td>{d.visitCount}</td>
                      <td>{d.lastVisited ? new Date(d.lastVisited).toLocaleDateString() : 'N/A'}</td>
                      <td>
                        {isBlocked
                          ? <button className="btn-sm btn-success" onClick={() => handleUnblock(d.domain)}>Unblock</button>
                          : <button className="btn-sm btn-danger" onClick={() => handleBlock(d.domain)}>Block</button>}
                      </td>
                    </tr>
                  );
                })}
              </tbody></table>
            ) : detailView === 'domain-devices' ? (
              <>
                <div className="domain-action-bar">
                  {isDomainBlocked(domainDeviceDetail?.domain) ? (
                    <button
                      className="btn-sm btn-success"
                      onClick={() => handleUnblock(domainDeviceDetail.domain)}
                    >
                      Unblock {domainDeviceDetail?.domain}
                    </button>
                  ) : (
                    <button
                      className="btn-sm btn-danger"
                      onClick={() => handleBlock(domainDeviceDetail.domain)}
                    >
                      Block {domainDeviceDetail?.domain}
                    </button>
                  )}
                </div>
                <table className="detail-table"><thead><tr><th>Device</th><th>Visit Count</th><th>Last Visited</th></tr></thead><tbody>
                  {domainDeviceDetail?.devices.map((d) => (
                    <tr key={d.deviceId}>
                      <td>{d.deviceName}</td>
                      <td>{d.visitCount}</td>
                      <td>{d.lastVisited ? new Date(d.lastVisited).toLocaleDateString() : 'N/A'}</td>
                    </tr>
                  ))}
                </tbody></table>
              </>
            ) : null}
          </div>
        </div>
      )}

      <div className="charts-grid">
        {graphConfig.deviceCount?.visible !== false && (
          <div className="chart-card"><div className="chart-title">{graphConfig.deviceCount?.title || 'Device Count by OS Build'}</div>
            <ResponsiveContainer width="100%" height={360}><BarChart data={osBuildData} onClick={handleDeviceBarClick}><CartesianGrid strokeDasharray="3 3" stroke="#eee" /><XAxis dataKey="build" fontSize={11} /><YAxis allowDecimals={false} fontSize={11} /><Tooltip /><Legend /><Bar dataKey="count" name="Devices" fill="#1976d2" radius={[4,4,0,0]} cursor="pointer" /></BarChart></ResponsiveContainer>
            <div className="chart-hint">{messages.deviceClickInfo || 'Click a bar to view devices'}</div></div>
        )}

        {graphConfig.topDomains?.visible !== false && (
          <div className="chart-card"><div className="chart-title-row"><div className="chart-title">{graphConfig.topDomains?.title || 'Top Visited Domains'}</div><button className="link-btn more-btn" onClick={() => setTopDomainsPopup(true)}>More ›</button></div>
            <ResponsiveContainer width="100%" height={360}><BarChart data={topDomains.slice(0, 10)} layout="vertical" onClick={handleDomainBarClick}><CartesianGrid strokeDasharray="3 3" stroke="#eee" /><XAxis type="number" fontSize={11} /><YAxis dataKey="domain" type="category" width={140} fontSize={10} /><Tooltip /><Bar dataKey="totalVisits" name="Total Visits" fill="#00897b" radius={[0,4,4,0]} cursor="pointer" /></BarChart></ResponsiveContainer>
            <div className="chart-hint">{messages.domainClickInfo || 'Click a bar to see visiting devices'}</div></div>
        )}

        {graphConfig.redFlagDomains?.visible !== false && (
          <div className="chart-card chart-card-redflag">
            <div className="chart-title-row"><div className="chart-title redflag-title"><span>⚠</span> {graphConfig.redFlagDomains?.title || 'Red Flag Domains Detected'}</div><button className="link-btn take-action-btn" onClick={() => setRedFlagActionPanel(true)}>Take Action</button></div>
            <ResponsiveContainer width="100%" height={360}><BarChart data={redFlagDomains.slice(0, 10)}><CartesianGrid strokeDasharray="3 3" stroke="#eee" /><XAxis dataKey="domain" fontSize={9} angle={-20} textAnchor="end" height={60} /><YAxis allowDecimals={false} fontSize={11} /><Tooltip /><Bar dataKey="totalVisits" name="Visits" radius={[4,4,0,0]}>{redFlagDomains.slice(0, 10).map((_, i) => <Cell key={i} fill={RED_FLAG_COLORS[i % RED_FLAG_COLORS.length]} />)}</Bar></BarChart></ResponsiveContainer>
            <div className="chart-hint-row"><span className="chart-hint">{messages.redFlagWarning || 'These domains have been flagged as potentially dangerous.'}</span><button className="link-btn see-more-btn" onClick={() => setRedFlagReasonsPopup(true)}>See more</button></div>
          </div>
        )}

        {graphConfig.appDomainPies?.visible !== false && (
          <div className="chart-card chart-card-redflag">
            <div className="chart-title-row">
              <div className="chart-title redflag-title"><span>⚠</span> {graphConfig.appDomainPies?.title || 'Top Flagged Domains by App'}</div>
              <button className="link-btn take-action-btn" onClick={() => openAppRedFlagPanel()}>More ›</button>
            </div>
            {appDomainPies.length === 0 ? (
              <div className="no-data" style={{ padding: '60px 20px', textAlign: 'center' }}>
                No data for Firefox or OpenClaw AI yet.
              </div>
            ) : (
              <div className="dual-pie-grid">
                {appDomainPies.map(({ app, data }) => (
                  <div key={app.applicationId} className="dual-pie-item">
                    <div className="dual-pie-title">
                      {app.icon ? `${app.icon} ` : ''}{app.name}
                    </div>
                    <ResponsiveContainer width="100%" height={320}>
                      <PieChart margin={{ top: 10, right: 10, bottom: 10, left: 10 }}>
                        <Pie
                          data={data}
                          dataKey="value"
                          nameKey="name"
                          cx="50%"
                          cy="50%"
                          outerRadius={75}
                          labelLine={{ stroke: '#999', strokeWidth: 0.6 }}
                          label={({ name, percent, x, y, cx }) => {
                            const short = name.length > 12 ? name.slice(0, 10) + '…' : name;
                            return (
                              <text
                                x={x}
                                y={y}
                                fill="#444"
                                fontSize={9}
                                textAnchor={x > cx ? 'start' : 'end'}
                                dominantBaseline="central"
                              >
                                {`${short} ${(percent * 100).toFixed(0)}%`}
                              </text>
                            );
                          }}
                          onClick={() => openAppRedFlagPanel(app.applicationId)}
                          cursor="pointer"
                        >
                          {data.map((entry, i) => (
                            <Cell
                              key={i}
                              fill={entry.name === 'Other' ? '#9e9e9e' : APP_RED_FLAG_COLORS[i % APP_RED_FLAG_COLORS.length]}
                            />
                          ))}
                        </Pie>
                        <Tooltip formatter={(v, n) => [`${v.toLocaleString()} visits`, n]} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                ))}
              </div>
            )}
            <div className="chart-hint-row">
              <span className="chart-hint">Top 5 flagged domains per app, with the remainder grouped as "Other". Click a slice or "More" to take action.</span>
              <button className="link-btn see-more-btn" onClick={() => openAppRedFlagPanel()}>See more</button>
            </div>
          </div>
        )}

        {graphConfig.appRedFlagDomains?.visible !== false && (() => {
          const s = appRfChartSettings;
          const isVertical = s.layout === 'vertical';
          const visibleData = appRedFlagChartData.slice(0, Math.max(1, s.maxItems));
          const itemCap = Math.max(3, appRedFlagChartData.length || 3);
          return (
          <div className="chart-card chart-card-redflag">
            <div className="chart-title-row">
              <div className="chart-title redflag-title"><span>⚠</span> {graphConfig.appRedFlagDomains?.title || 'App-Level Red Flag Domains'}</div>
              <button className="link-btn take-action-btn" onClick={() => openAppRedFlagPanel()}>Take Action</button>
            </div>
            {appRedFlagChartData.length === 0 ? (
              <div className="no-data" style={{ padding: '60px 20px', textAlign: 'center' }}>No applications configured. Add some in Configuration → Applications.</div>
            ) : (
              <div className="chart-resizable-wrap" style={{ width: `${s.widthPct}%` }}>
                <ResponsiveContainer width="100%" height={s.height}>
                  <BarChart
                    data={visibleData}
                    layout={s.layout}
                    margin={isVertical
                      ? { top: 5, right: 24, bottom: 5, left: 5 }
                      : { top: 5, right: 16, bottom: 70, left: 5 }}
                    onClick={(e) => {
                      const id = e?.activePayload?.[0]?.payload?.applicationId;
                      if (id) { setAppRedFlagSelected(id); setAppRedFlagPanel(true); }
                    }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                    {isVertical ? (
                      <>
                        <XAxis type="number" allowDecimals={false} fontSize={s.fontSize} />
                        <YAxis dataKey="label" type="category" width={s.yAxisWidth} fontSize={s.fontSize} interval={0} />
                      </>
                    ) : (
                      <>
                        <XAxis dataKey="label" fontSize={s.fontSize} angle={-25} textAnchor="end" height={80} interval={0} />
                        <YAxis type="number" allowDecimals={false} fontSize={s.fontSize} />
                      </>
                    )}
                    <Tooltip
                      content={({ active, payload }) => active && payload?.[0] ? (
                        <div className="custom-tooltip">
                          <p className="tt-name">{payload[0].payload.label}</p>
                          <p>Total Flagged Visits: <strong>{payload[0].value?.toLocaleString()}</strong></p>
                          <p>Flagged Domains: {payload[0].payload.domainCount}</p>
                          <p className="muted" style={{ fontSize: 10, wordBreak: 'break-all' }}>{payload[0].payload.path}</p>
                        </div>
                      ) : null}
                    />
                    <Bar
                      dataKey="totalVisits"
                      name="Flagged Visits"
                      radius={isVertical ? [0, 4, 4, 0] : [4, 4, 0, 0]}
                      barSize={s.barSize}
                      cursor="pointer"
                    >
                      {visibleData.map((_, i) => <Cell key={i} fill={APP_RED_FLAG_COLORS[i % APP_RED_FLAG_COLORS.length]} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
            <div className="chart-hint-row">
              <span className="chart-hint">{messages.appRedFlagWarning || 'A domain may be risky for one app but not another. Block at app-level to scope the rule precisely.'}</span>
              <div className="chart-hint-actions">
                <button
                  type="button"
                  className={`chart-settings-btn ${appRfSettingsOpen ? 'is-open' : ''}`}
                  onClick={() => setAppRfSettingsOpen((v) => !v)}
                  aria-pressed={appRfSettingsOpen}
                  aria-label={appRfSettingsOpen ? 'Hide chart settings' : 'Customize chart'}
                  title={appRfSettingsOpen ? 'Hide chart settings' : 'Customize chart'}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <circle cx="12" cy="12" r="3" />
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                  </svg>
                </button>
                <button className="link-btn see-more-btn" onClick={() => openAppRedFlagPanel()}>See more</button>
              </div>
            </div>
            {appRfSettingsOpen && (
              <div className="chart-settings-panel">
                <div className="chart-settings-header">
                  <span className="chart-settings-title">Customize chart</span>
                  <div className="chart-settings-header-actions">
                    <button type="button" className="chart-settings-reset" onClick={resetAppRfChartSettings} title="Restore defaults">Reset</button>
                    <button type="button" className="chart-settings-close" onClick={() => setAppRfSettingsOpen(false)} aria-label="Close settings">✕</button>
                  </div>
                </div>
                <div className="chart-settings-grid">
                  <label className="chart-settings-field">
                    <span className="chart-settings-label">Layout</span>
                    <select
                      className="chart-settings-select"
                      value={s.layout}
                      onChange={(e) => updateAppRfChartSetting('layout', e.target.value)}
                    >
                      <option value="vertical">Horizontal bars</option>
                      <option value="horizontal">Vertical bars</option>
                    </select>
                  </label>

                  <label className="chart-settings-field">
                    <span className="chart-settings-label">Width <em>{s.widthPct}%</em></span>
                    <input
                      type="range"
                      min="50"
                      max="100"
                      step="5"
                      value={s.widthPct}
                      onChange={(e) => updateAppRfChartSetting('widthPct', Number(e.target.value))}
                    />
                  </label>

                  <label className="chart-settings-field">
                    <span className="chart-settings-label">Height <em>{s.height}px</em></span>
                    <input
                      type="range"
                      min="240"
                      max="720"
                      step="20"
                      value={s.height}
                      onChange={(e) => updateAppRfChartSetting('height', Number(e.target.value))}
                    />
                  </label>

                  <label className="chart-settings-field">
                    <span className="chart-settings-label">Bar thickness <em>{s.barSize}px</em></span>
                    <input
                      type="range"
                      min="6"
                      max="40"
                      step="1"
                      value={s.barSize}
                      onChange={(e) => updateAppRfChartSetting('barSize', Number(e.target.value))}
                    />
                  </label>

                  <label className={`chart-settings-field ${!isVertical ? 'is-disabled' : ''}`}>
                    <span className="chart-settings-label">Label width <em>{s.yAxisWidth}px</em></span>
                    <input
                      type="range"
                      min="80"
                      max="280"
                      step="10"
                      value={s.yAxisWidth}
                      disabled={!isVertical}
                      onChange={(e) => updateAppRfChartSetting('yAxisWidth', Number(e.target.value))}
                    />
                  </label>

                  <label className="chart-settings-field">
                    <span className="chart-settings-label">Font size <em>{s.fontSize}px</em></span>
                    <input
                      type="range"
                      min="8"
                      max="16"
                      step="1"
                      value={s.fontSize}
                      onChange={(e) => updateAppRfChartSetting('fontSize', Number(e.target.value))}
                    />
                  </label>

                  <label className="chart-settings-field">
                    <span className="chart-settings-label">Max apps <em>{Math.min(s.maxItems, itemCap)}</em></span>
                    <input
                      type="range"
                      min="3"
                      max={itemCap}
                      step="1"
                      value={Math.min(s.maxItems, itemCap)}
                      onChange={(e) => updateAppRfChartSetting('maxItems', Number(e.target.value))}
                    />
                  </label>
                </div>
                <div className="chart-settings-footnote">Settings are saved to this browser.</div>
              </div>
            )}
          </div>
          );
        })()}

        {graphConfig.browsingCategories?.visible !== false && (
          <div className="chart-card"><div className="chart-title-row"><div className="chart-title">{graphConfig.browsingCategories?.title || 'Browsing by Category'}</div><button className="link-btn more-btn" onClick={() => setCategoriesPopup(true)}>More ›</button></div>
            <ResponsiveContainer width="100%" height={360}>
              <Treemap data={treemapData} dataKey="value" nameKey="name" content={<CustomTreemapContent />} animationDuration={300}>
                <Tooltip formatter={(v, n) => [`${v.toLocaleString()} visits`, n]} />
              </Treemap>
            </ResponsiveContainer>
          </div>
        )}

        {graphConfig.riskScores?.visible !== false && (
          <div className="chart-card"><div className="chart-title-row"><div className="chart-title">{graphConfig.riskScores?.title || 'Device Risk Scores'}</div><button className="link-btn more-btn" onClick={() => setRiskScoresPopup(true)}>More ›</button></div>
            <ResponsiveContainer width="100%" height={360}><BarChart data={riskScores}><CartesianGrid strokeDasharray="3 3" stroke="#eee" /><XAxis dataKey="deviceName" fontSize={9} angle={-25} textAnchor="end" height={60} /><YAxis domain={[0, 100]} fontSize={11} /><Tooltip content={({ active, payload }) => active && payload?.[0] ? <div className="custom-tooltip"><p className="tt-name">{payload[0].payload.deviceName}</p><p>Risk Score: <strong>{payload[0].value}</strong>/100</p><p>Flagged Domains: {payload[0].payload.rfDomainCount}</p><p>Flagged Visits: {payload[0].payload.rfVisits}</p></div> : null} /><Bar dataKey="riskScore" name="Risk Score" radius={[4,4,0,0]}>{riskScores.map((d, i) => <Cell key={i} fill={d.riskScore >= 60 ? '#c62828' : d.riskScore >= 30 ? '#ef6c00' : '#2e7d32'} />)}</Bar></BarChart></ResponsiveContainer>
          </div>
        )}

        {graphConfig.hourlyTraffic?.visible !== false && (
          <div className="chart-card"><div className="chart-title-row"><div className="chart-title">{graphConfig.hourlyTraffic?.title || 'Traffic by Hour'}</div><button className="link-btn more-btn" onClick={() => setHourlyTrafficPopup(true)}>More ›</button></div>
            <ResponsiveContainer width="100%" height={360}><AreaChart data={hourlyTraffic}><CartesianGrid strokeDasharray="3 3" stroke="#eee" /><XAxis dataKey="hour" fontSize={10} /><YAxis fontSize={11} /><Tooltip /><Legend /><Area type="monotone" dataKey="safe" name="Safe Traffic" stroke="#2e7d32" fill="rgba(46,125,50,0.15)" strokeWidth={2} stackId="1" /><Area type="monotone" dataKey="flagged" name="Flagged Traffic" stroke="#c62828" fill="rgba(198,40,40,0.2)" strokeWidth={2} stackId="1" /></AreaChart></ResponsiveContainer>
          </div>
        )}

        {graphConfig.domainsPerDevice?.visible !== false && (
          <div className="chart-card"><div className="chart-title-row"><div className="chart-title">{graphConfig.domainsPerDevice?.title || 'Unique Domains per Device'}</div><button className="link-btn more-btn" onClick={() => setDomainsPerDevicePopup(true)}>More ›</button></div>
            <ResponsiveContainer width="100%" height={360}><BarChart data={domainsPerDevice}><CartesianGrid strokeDasharray="3 3" stroke="#eee" /><XAxis dataKey="deviceName" fontSize={9} angle={-25} textAnchor="end" height={60} /><YAxis allowDecimals={false} fontSize={11} /><Tooltip /><Legend /><Bar dataKey="safe" name="Safe Domains" fill="#1976d2" stackId="stack" radius={[0,0,0,0]} /><Bar dataKey="flagged" name="Flagged Domains" fill="#c62828" stackId="stack" radius={[4,4,0,0]} /></BarChart></ResponsiveContainer>
          </div>
        )}

        {graphConfig.enrollmentTimeline?.visible !== false && (
          <div className="chart-card"><div className="chart-title">{graphConfig.enrollmentTimeline?.title || 'Device Enrollment Timeline'}</div>
            <ResponsiveContainer width="100%" height={360}><AreaChart data={enrollmentTimeline}><CartesianGrid strokeDasharray="3 3" stroke="#eee" /><XAxis dataKey="month" fontSize={11} /><YAxis allowDecimals={false} fontSize={11} /><Tooltip /><Area type="monotone" dataKey="count" name="Enrollments" stroke="#7b1fa2" fill="rgba(123,31,162,0.15)" strokeWidth={2} /></AreaChart></ResponsiveContainer>
          </div>
        )}

        {graphConfig.managedVsUnmanaged?.visible !== false && (
          <div className="chart-card"><div className="chart-title">{graphConfig.managedVsUnmanaged?.title || 'Managed vs Unmanaged'}</div>
            <ResponsiveContainer width="100%" height={360}><PieChart><Pie data={managedPieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={130} label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>{managedPieData.map((_, i) => <Cell key={i} fill={i === 0 ? '#2e7d32' : '#ef6c00'} />)}</Pie><Tooltip /><Legend /></PieChart></ResponsiveContainer>
          </div>
        )}

        {graphConfig.complianceStatus?.visible !== false && (
          <div className="chart-card"><div className="chart-title">{graphConfig.complianceStatus?.title || 'Compliance Status'}</div>
            <ResponsiveContainer width="100%" height={360}><PieChart><Pie data={compliancePieData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={70} outerRadius={130} label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>{compliancePieData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}</Pie><Tooltip /><Legend /></PieChart></ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Red Flag Take Action */}
      {redFlagActionPanel && (
        <div className="modal-overlay" onClick={() => { setRedFlagActionPanel(false); setRedFlagActionSearch(''); }}><div className="popup-wide" onClick={(e) => e.stopPropagation()}><div className="popup-header"><h3>⚠ Red Flag Domains — Take Action</h3><button className="detail-close" onClick={() => { setRedFlagActionPanel(false); setRedFlagActionSearch(''); }}>✕</button></div><div className="popup-body">
          <div className="popup-search-row"><input className="popup-search" placeholder="Search by domain…" value={redFlagActionSearch} onChange={(e) => setRedFlagActionSearch(e.target.value)} /><span className="popup-count">{filteredRedFlagAction.length} of {allRedFlagForAction.length}</span></div>
          {filteredRedFlagAction.length === 0 ? <p className="no-data">No matches found.</p> : (
            <table className="detail-table"><thead><tr><th>Domain</th><th>Total Visits</th><th>Devices Affected</th><th>Action</th></tr></thead><tbody>
              {filteredRedFlagAction.map((r) => {
                const isBlocked = isDomainBlocked(r.domain);
                return (
                  <tr key={r.domain} className="row-redflag">
                    <td><span className="redflag-icon">⚠</span>{r.domain}</td>
                    <td>{r.totalVisits.toLocaleString()}</td>
                    <td>{r.deviceCount}</td>
                    <td>
                      {isBlocked ? (
                        <button
                          className="btn-sm btn-success"
                          style={{ backgroundColor: '#2e7d32', borderColor: '#2e7d32' }}
                          onClick={() => handleUnblock(r.domain)}
                        >
                          Unblock
                        </button>
                      ) : (
                        <button
                          className="btn-sm btn-danger"
                          onClick={() => handleBlock(r.domain)}
                        >
                          Block
                        </button>
                      )}
                    </td>
               
                  </tr>
                );
              })}
            </tbody></table>
          )}
        </div></div></div>
      )}

      {/* App-Level Red Flag Take Action */}
      {appRedFlagPanel && (
        <div className="modal-overlay" onClick={() => { setAppRedFlagPanel(false); setAppRedFlagSearch(''); setAppRedFlagSelected(null); }}>
          <div className="popup-wide" onClick={(e) => e.stopPropagation()}>
            <div className="popup-header">
              <h3>⚠ App-Level Red Flag Domains — Take Action</h3>
              <div className="popup-header-actions">
                <button className="btn-sm btn-outline" onClick={() => { fetchAppRedFlagDomains(); fetchAppBlockedDomains(); }}>Refresh</button>
                <button className="detail-close" onClick={() => { setAppRedFlagPanel(false); setAppRedFlagSearch(''); setAppRedFlagSelected(null); }}>✕</button>
              </div>
            </div>
            <div className="popup-body">
              {/* <div className="info-card">
                <div className="info-card-title">How app-level blocking works</div>
                <p>Each application has its own list of red-flag domains based on observed risk-in-context. Blocking at app level inserts a brand-new <code>DeviceTrafficRule</code> + <code>TrafficRulesApplicationMapping</code> row scoped to the app's executable path, then bumps the rule-set <code>Version</code> and publishes via the MDM API.</p>
              </div> */}
              <div className="popup-search-row" style={{ flexWrap: 'wrap', gap: 8 }}>
                <input className="popup-search" placeholder="Search application or domain…" value={appRedFlagSearch} onChange={(e) => setAppRedFlagSearch(e.target.value)} />
                <select
                  className="platform-dropdown"
                  value={appRedFlagSelected || ''}
                  onChange={(e) => setAppRedFlagSelected(e.target.value || null)}
                >
                  <option value="">All Applications</option>
                  {(appRedFlagDomains || []).map((a) => (
                    <option key={a.applicationId} value={a.applicationId}>{a.icon ? `${a.icon} ` : ''}{a.name}</option>
                  ))}
                </select>
                <span className="popup-count">{filteredAppRedFlag.length} app{filteredAppRedFlag.length === 1 ? '' : 's'}</span>
              </div>
              {filteredAppRedFlag.length === 0 ? (
                <p className="no-data">No matches found.</p>
              ) : (
                <div className="category-list">
                  {filteredAppRedFlag.map((app) => (
                    <div key={app.applicationId} className="category-card">
                      <div className="category-card-header">
                        <span className="category-name">{app.icon ? `${app.icon} ` : ''}{app.name}</span>
                        <span className="category-meta">
                          <strong>{(app.totalVisits || 0).toLocaleString()}</strong> flagged visits ·
                          {' '}{(app.domains || []).length} domain{(app.domains || []).length === 1 ? '' : 's'}
                        </span>
                      </div>
                      <div className="app-path" style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 8, wordBreak: 'break-all' }}>{app.path}</div>
                      {(app.domains || []).length === 0 ? (
                        <p className="no-data" style={{ padding: 8 }}>No flagged domains for this app.</p>
                      ) : (
                        <table className="detail-table"><thead><tr><th>Domain</th><th>Visits</th><th>Devices</th><th>Action</th></tr></thead><tbody>
                          {app.domains.map((d) => {
                            const blocked = isAppDomainBlocked(app.applicationId, d.domain, app.path);
                            return (
                              <tr key={`${app.applicationId}-${d.domain}`} className="row-redflag">
                                <td><span className="redflag-icon">⚠</span>{d.domain}</td>
                                <td>{(d.totalVisits || 0).toLocaleString()}</td>
                                <td>{d.deviceCount || 0}</td>
                                <td>
                                  {blocked ? (
                                    <button
                                      className="btn-sm btn-success"
                                      style={{ backgroundColor: '#2e7d32', borderColor: '#2e7d32' }}
                                      onClick={() => handleAppUnblock(d.domain, app)}
                                    >
                                      Unblock for {app.name}
                                    </button>
                                  ) : (
                                    <button className="btn-sm btn-danger" onClick={() => handleAppBlock(d.domain, app)}>
                                      Block for {app.name}
                                    </button>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody></table>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Top Domains - More */}
      {topDomainsPopup && (
        <div className="modal-overlay" onClick={() => { setTopDomainsPopup(false); setTopDomainsSearch(''); }}><div className="popup-wide" onClick={(e) => e.stopPropagation()}><div className="popup-header"><h3>All Visited Domains</h3><button className="detail-close" onClick={() => { setTopDomainsPopup(false); setTopDomainsSearch(''); }}>✕</button></div><div className="popup-body">
          <div className="popup-intro">Full list of domains observed across all devices, sorted by total visits. Click a row to see which devices visited the domain.</div>
          <div className="popup-search-row"><input className="popup-search" placeholder="Search domains…" value={topDomainsSearch} onChange={(e) => setTopDomainsSearch(e.target.value)} /><span className="popup-count">{filteredTopDomains.length} of {allDomainsAggregated.length}</span></div>
          {filteredTopDomains.length === 0 ? <p className="no-data">No domains match your search.</p> : (
            <table className="detail-table"><thead><tr><th>#</th><th>Domain</th><th>Total Visits</th><th>Devices</th><th>Status</th></tr></thead><tbody>
              {filteredTopDomains.map((d, i) => (
                <tr key={d.domain} className={d.isRedFlag ? 'row-redflag' : ''} onClick={() => handleDomainBarClick({ activePayload: [{ payload: { domain: d.domain } }] })} style={{ cursor: 'pointer' }}>
                  <td className="mono">{i + 1}</td>
                  <td>{d.isRedFlag && <span className="redflag-icon">⚠</span>}{d.domain}</td>
                  <td>{d.totalVisits.toLocaleString()}</td>
                  <td>{d.deviceCount}</td>
                  <td><span className={`badge ${d.isRedFlag ? 'badge-red' : 'badge-green'}`}>{d.isRedFlag ? 'Flagged' : 'Safe'}</span></td>
                </tr>
              ))}
            </tbody></table>
          )}
        </div></div></div>
      )}

      {/* Browsing Categories - More */}
      {categoriesPopup && (
        <div className="modal-overlay" onClick={() => { setCategoriesPopup(false); setCategoriesSearch(''); }}><div className="popup-wide" onClick={(e) => e.stopPropagation()}><div className="popup-header"><h3>Browsing by Category — Details</h3><button className="detail-close" onClick={() => { setCategoriesPopup(false); setCategoriesSearch(''); }}>✕</button></div><div className="popup-body">
          <div className="info-card">
            <div className="info-card-title">How domains are categorized</div>
            <p>Domains are classified using a <strong>hybrid AI + rules-based pipeline</strong> that combines multiple signals:</p>
            <ul className="info-list">
              <li><strong>AI content classifier</strong> — an LLM-backed categorization engine inspects page titles, meta descriptions, and content signals to tag each domain.</li>
              <li><strong>DNS &amp; WHOIS metadata</strong> — domain age, registrar, TLD, and geographic hints feed into a reputation score.</li>
              <li><strong>Threat-intel feeds</strong> — cross-referenced with commercial and open-source feeds for categories like Malware, Phishing, and Unauthorized File-Sharing.</li>
              <li><strong>Curated dictionary</strong> — a human-maintained allowlist/denylist ensures stable categorization for well-known brands and business-critical domains.</li>
              <li><strong>Fallback</strong> — any domain that none of the layers can classify is marked as <em>Uncategorized</em> and queued for review.</li>
            </ul>
          </div>
          <div className="popup-search-row"><input className="popup-search" placeholder="Search category or domain…" value={categoriesSearch} onChange={(e) => setCategoriesSearch(e.target.value)} /><span className="popup-count">{categoriesDetailed.length} categories</span></div>
          {categoriesDetailed.length === 0 ? <p className="no-data">No categories match your search.</p> : (
            <div className="category-list">
              {categoriesDetailed.map((c) => (
                <div key={c.category} className="category-card">
                  <div className="category-card-header">
                    <span className="category-name">{c.category}</span>
                    <span className="category-meta"><strong>{c.totalVisits.toLocaleString()}</strong> visits · {c.deviceCount} device{c.deviceCount === 1 ? '' : 's'} · {c.domains.length} domain{c.domains.length === 1 ? '' : 's'}</span>
                  </div>
                  {c.domains.length > 0 && (
                    <div className="category-domains">
                      {c.domains.map((d) => (
                        <span key={d.domain} className={`domain-chip ${c.category === 'Malicious / Red Flag' ? 'domain-chip-red' : ''}`}>{d.domain} <span className="domain-chip-visits">{d.visits.toLocaleString()}</span></span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div></div></div>
      )}

      {/* Risk Scores - More */}
      {riskScoresPopup && (
        <div className="modal-overlay" onClick={() => { setRiskScoresPopup(false); setRiskScoresSearch(''); }}><div className="popup-wide" onClick={(e) => e.stopPropagation()}><div className="popup-header"><h3>Device Risk Scores — Details</h3><button className="detail-close" onClick={() => { setRiskScoresPopup(false); setRiskScoresSearch(''); }}>✕</button></div><div className="popup-body">
          <div className="info-card">
            <div className="info-card-title">How risk scores are calculated</div>
            <p>Each device gets a <strong>0–100 risk score</strong> that blends behavioral and threat-intel signals:</p>
            <ul className="info-list">
              <li><strong>Flagged-visit ratio</strong> — share of browsing that went to red-flagged destinations (weighted heavily).</li>
              <li><strong>Flagged-domain breadth</strong> — number of distinct malicious or suspicious domains touched.</li>
              <li><strong>Behavioral anomalies</strong> — off-hours traffic spikes, sudden change in categories, and unusual volume.</li>
              <li><strong>Device posture</strong> — enrollment, compliance, and whether the tunnel is active.</li>
            </ul>
            <div className="severity-legend">
              <span className="sev sev-high">High ≥ 60</span>
              <span className="sev sev-med">Medium 30–59</span>
              <span className="sev sev-low">Low &lt; 30</span>
            </div>
          </div>
          <div className="popup-search-row"><input className="popup-search" placeholder="Search device…" value={riskScoresSearch} onChange={(e) => setRiskScoresSearch(e.target.value)} /><span className="popup-count">{filteredRiskScores.length} of {riskScoresDetailed.length}</span></div>
          {filteredRiskScores.length === 0 ? <p className="no-data">No devices match your search.</p> : (
            <table className="detail-table"><thead><tr><th>Device</th><th>Risk</th><th>Flagged Domains</th><th>Flagged / Total Visits</th><th>Why</th></tr></thead><tbody>
              {filteredRiskScores.map((r) => (
                <tr key={r.deviceId} className={r.severity === 'High' ? 'row-redflag' : ''}>
                  <td>{r.deviceName}</td>
                  <td><span className={`risk-pill risk-${r.severity.toLowerCase()}`}>{r.riskScore} · {r.severity}</span></td>
                  <td>{r.rfDomainCount}</td>
                  <td>{r.rfVisits.toLocaleString()} / {r.totalVisits.toLocaleString()} <span className="muted">({r.pctFlagged}%)</span></td>
                  <td>
                    <ul className="why-list">{r.factors.map((f, i) => <li key={i}>{f}</li>)}</ul>
                    {r.topFlagged.length > 0 && (
                      <div className="why-top">Top flagged: {r.topFlagged.map((t) => `${t.domain} (${t.visits})`).join(', ')}</div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody></table>
          )}
        </div></div></div>
      )}

      {/* Hourly Traffic - More */}
      {hourlyTrafficPopup && (
        <div className="modal-overlay" onClick={() => setHourlyTrafficPopup(false)}><div className="popup-wide" onClick={(e) => e.stopPropagation()}><div className="popup-header"><h3>Traffic by Hour — Details</h3><button className="detail-close" onClick={() => setHourlyTrafficPopup(false)}>✕</button></div><div className="popup-body">
          <div className="info-card">
            <div className="info-card-title">How this is measured</div>
            <p>Each domain visit is bucketed by the local hour of its last-visited timestamp. Visits are labelled <strong>Safe</strong> or <strong>Flagged</strong> using the threat-intel categorization.</p>
            <div className="stat-grid">
              <div className="stat-card"><span className="stat-label">Total Safe Visits</span><span className="stat-value stat-safe">{hourlyTrafficDetailed.total.safe.toLocaleString()}</span></div>
              <div className="stat-card"><span className="stat-label">Total Flagged Visits</span><span className="stat-value stat-danger">{hourlyTrafficDetailed.total.flagged.toLocaleString()}</span></div>
              <div className="stat-card"><span className="stat-label">Peak Hour</span><span className="stat-value">{hourlyTrafficDetailed.peak?.hour || '—'} <span className="muted">({(hourlyTrafficDetailed.peak?.total || 0).toLocaleString()})</span></span></div>
              <div className="stat-card"><span className="stat-label">Most Flagged Hour</span><span className="stat-value stat-danger">{hourlyTrafficDetailed.peakFlagged?.hour || '—'} <span className="muted">({(hourlyTrafficDetailed.peakFlagged?.flagged || 0).toLocaleString()})</span></span></div>
            </div>
          </div>
          <table className="detail-table"><thead><tr><th>Hour</th><th>Safe</th><th>Flagged</th><th>Total</th><th>Flagged %</th></tr></thead><tbody>
            {hourlyTrafficDetailed.hours.map((h) => (
              <tr key={h.hour} className={h.flaggedPct >= 50 ? 'row-redflag' : ''}>
                <td className="mono">{h.hour}</td>
                <td>{h.safe.toLocaleString()}</td>
                <td>{h.flagged.toLocaleString()}</td>
                <td>{h.total.toLocaleString()}</td>
                <td>
                  <div className="pct-bar-wrap"><div className="pct-bar" style={{ width: `${h.flaggedPct}%` }} /><span className="pct-label">{h.flaggedPct}%</span></div>
                </td>
              </tr>
            ))}
          </tbody></table>
        </div></div></div>
      )}

      {/* Domains Per Device - More */}
      {domainsPerDevicePopup && (
        <div className="modal-overlay" onClick={() => { setDomainsPerDevicePopup(false); setDomainsPerDeviceSearch(''); }}><div className="popup-wide" onClick={(e) => e.stopPropagation()}><div className="popup-header"><h3>Unique Domains per Device — Details</h3><button className="detail-close" onClick={() => { setDomainsPerDevicePopup(false); setDomainsPerDeviceSearch(''); }}>✕</button></div><div className="popup-body">
          <div className="info-card">
            <div className="info-card-title">What's counted</div>
            <p>For every device we count <strong>distinct domains</strong> (not visits) and split them into safe and flagged buckets. A wider surface area usually correlates with higher exposure risk.</p>
          </div>
          <div className="popup-search-row"><input className="popup-search" placeholder="Search device…" value={domainsPerDeviceSearch} onChange={(e) => setDomainsPerDeviceSearch(e.target.value)} /><span className="popup-count">{filteredDomainsPerDevice.length} of {domainsPerDevice.length}</span></div>
          {filteredDomainsPerDevice.length === 0 ? <p className="no-data">No devices match your search.</p> : (
            <table className="detail-table"><thead><tr><th>Device</th><th>Safe Domains</th><th>Flagged Domains</th><th>Total</th><th>Exposure</th></tr></thead><tbody>
              {filteredDomainsPerDevice.map((d) => {
                const pct = d.total > 0 ? Math.round((d.flagged / d.total) * 100) : 0;
                return (
                  <tr key={d.deviceName} className={d.flagged > 0 ? 'row-redflag' : ''}>
                    <td>{d.deviceName}</td>
                    <td>{d.safe}</td>
                    <td>{d.flagged}</td>
                    <td>{d.total}</td>
                    <td><div className="pct-bar-wrap"><div className="pct-bar" style={{ width: `${pct}%` }} /><span className="pct-label">{pct}% flagged</span></div></td>
                  </tr>
                );
              })}
            </tbody></table>
          )}
        </div></div></div>
      )}

      {/* Red Flag Reasons */}
      {redFlagReasonsPopup && (
        <div className="modal-overlay" onClick={() => setRedFlagReasonsPopup(false)}><div className="popup-wide" onClick={(e) => e.stopPropagation()}><div className="popup-header"><h3>Why Are These Domains Red-Flagged?</h3><button className="detail-close" onClick={() => setRedFlagReasonsPopup(false)}>✕</button></div><div className="popup-body popup-reasons">
          {redFlagDomains.map((rf) => { const reasons = redFlagReasons[rf.domain]; return (<div key={rf.domain} className="reason-card"><div className="reason-domain"><span className="redflag-icon">⚠</span> {rf.domain}</div>{reasons?.length > 0 ? <ul className="reason-list">{reasons.map((r, i) => <li key={i}>{r}</li>)}</ul> : <p className="reason-fallback">Flagged based on threat intelligence feeds and behavioral analysis.</p>}</div>); })}
        </div></div></div>
      )}

      {/* Traffic Rules */}
      {trafficRulesPopup && (
        <div className="modal-overlay" onClick={() => setTrafficRulesPopup(false)}><div className="popup-wide" onClick={(e) => e.stopPropagation()}><div className="popup-header">
          <h3>Device Traffic Rules</h3>
          <div className="popup-header-actions">
            <button className="btn-sm btn-outline" onClick={fetchTrafficRules} disabled={trafficRulesLoading}>{trafficRulesLoading ? 'Refreshing…' : 'Refresh'}</button>
            <button className="detail-close" onClick={() => setTrafficRulesPopup(false)}>✕</button>
          </div>
        </div><div className="popup-body">
          {trafficRulesLoading && groupedTrafficRules.length === 0 ? <div className="dashboard-loading"><div className="spinner" /><p>Loading traffic rules…</p></div>
          : trafficRulesError ? <div className="traffic-rules-error"><p><strong>Unable to load traffic rules</strong></p><p>{trafficRulesError}</p><p className="hint">Traffic rules are fetched live from SQL Server and are not cached locally.</p></div>
          : groupedTrafficRules.length === 0 ? <p className="no-data">No traffic rules configured.</p>
          : groupedTrafficRules.map((g) => (
            <div key={g.ruleSetId} className="traffic-rule-group"><div className="traffic-rule-header"><span className="traffic-rule-name">{g.ruleSetName}</span><span className="traffic-rule-meta">Default: <span className={`badge ${ACTION_CLASS[g.defaultAction] || 'badge-orange'}`}>{ACTION_MAP[g.defaultAction] || g.defaultAction}</span> &middot; v{g.version}</span></div>
              <table className="detail-table traffic-table"><thead><tr><th>App Name</th><th>Action</th><th>Destination</th></tr></thead><tbody>
                {g.rules.map((r, i) => (<tr key={`${r.RuleId}-${r.ApplicationId}-${i}`}><td className="app-name-cell"><span className="app-name">{r.FriendlyName || 'N/A'}</span><span className="app-path">{r.BundleId || ''}</span></td><td><span className={`badge ${ACTION_CLASS[r.Action] || 'badge-orange'}`}>{ACTION_MAP[r.Action] || r.Action}</span></td><td className="mono">{r.DestinationUrl}</td></tr>))}
              </tbody></table></div>
          ))}
        </div></div></div>
      )}

      {confirmModal && (
        <ConfirmModal
          title={confirmModal.title}
          message={confirmModal.message}
          danger={confirmModal.danger}
          confirmLabel={confirmModal.confirmLabel}
          loading={!!confirmModal.loading}
          loadingLabel={confirmModal.loadingLabel}
          loadingMessage={confirmModal.loadingMessage}
          onConfirm={confirmModal.onConfirm}
          onCancel={() => { if (!confirmModal.loading) setConfirmModal(null); }}
        />
      )}
    </div>
  );
}
