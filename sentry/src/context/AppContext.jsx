import { createContext, useContext, useState, useEffect, useCallback } from 'react';

const AppContext = createContext();
 //const API_BASE = 'http://localhost:3001/api';
const API_BASE = 'https://snl.ssdevrd.com/snlapi/api';

export function AppProvider({ children }) {
  const [devices, setDevices] = useState([]);
  const [config, setConfig] = useState(null);
  const [topDomains, setTopDomains] = useState([]);
  const [redFlagDomains, setRedFlagDomains] = useState([]);
  const [allDomainData, setAllDomainData] = useState({});
  const [trafficRules, setTrafficRules] = useState([]);
  const [trafficRulesError, setTrafficRulesError] = useState(null);
  const [trafficRulesLoading, setTrafficRulesLoading] = useState(false);
  const [redFlagReasons, setRedFlagReasons] = useState({});
  const [browsingCategories, setBrowsingCategories] = useState([]);
  const [riskScores, setRiskScores] = useState([]);
  const [hourlyTraffic, setHourlyTraffic] = useState([]);
  const [domainsPerDevice, setDomainsPerDevice] = useState([]);
  const [domainCategoriesMap, setDomainCategoriesMap] = useState({});
  const [appRedFlagDomains, setAppRedFlagDomains] = useState([]);
  const [appBlockedDomains, setAppBlockedDomains] = useState({ byBundleId: {}, byApplicationUuid: {}, blockedRules: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notification, setNotification] = useState(null);

  const showNotification = useCallback((message, type = 'info') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 4000);
  }, []);

  // Authoritative per-app blocked domains. The backend proxies the MDM v2
  // device-traffic-rule-sets query (avoiding browser CORS) and returns the
  // parsed maps. Used to flip Block / Unblock labels in the per-app UI and
  // to refresh the popup after every block / unblock attempt.
  const fetchAppBlockedDomains = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/applications/blocked-domains`, { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      setAppBlockedDomains({
        byBundleId: data.byBundleId || {},
        byApplicationUuid: data.byApplicationUuid || {},
        blockedRules: data.blockedRules || [],
      });
    } catch {
      // swallow — surface is optional
    }
  }, []);

  const fetchTrafficRules = useCallback(async () => {
    setTrafficRulesLoading(true);
    try {
      const trRes = await fetch(`${API_BASE}/traffic-rules`, { cache: 'no-store' });
      if (trRes.ok) {
        setTrafficRules(await trRes.json());
        setTrafficRulesError(null);
      } else {
        const err = await trRes.json().catch(() => ({}));
        setTrafficRulesError(err.error || 'Unavailable');
        setTrafficRules([]);
      }
    } catch {
      setTrafficRulesError('Could not connect to traffic rules API');
      setTrafficRules([]);
    } finally {
      setTrafficRulesLoading(false);
    }
  }, []);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [devRes, cfgRes] = await Promise.all([
        fetch(`${API_BASE}/devices`),
        fetch(`${API_BASE}/config`),
      ]);
      setDevices(await devRes.json());
      setConfig(await cfgRes.json());

      const [topRes, rfRes, allRes, rrRes, catRes, riskRes, hourRes, dpdRes, dcRes, appRfRes] = await Promise.all([
        fetch(`${API_BASE}/analytics/top-domains`),
        fetch(`${API_BASE}/analytics/redflag-domains`),
        fetch(`${API_BASE}/analytics/all-domain-data`),
        fetch(`${API_BASE}/redflag-reasons`),
        fetch(`${API_BASE}/analytics/browsing-categories`),
        fetch(`${API_BASE}/analytics/domain-risk-scores`),
        fetch(`${API_BASE}/analytics/hourly-traffic`),
        fetch(`${API_BASE}/analytics/unique-domains-per-device`),
        fetch(`${API_BASE}/domain-categories`),
        fetch(`${API_BASE}/analytics/app-redflag-domains`),
      ]);
      setTopDomains(await topRes.json());
      setRedFlagDomains(await rfRes.json());
      setAllDomainData(await allRes.json());
      setRedFlagReasons(await rrRes.json());
      setBrowsingCategories(await catRes.json());
      setRiskScores(await riskRes.json());
      setHourlyTraffic(await hourRes.json());
      setDomainsPerDevice(await dpdRes.json());
      setDomainCategoriesMap(await dcRes.json());
      try { setAppRedFlagDomains(await appRfRes.json()); } catch { setAppRedFlagDomains([]); }

      await fetchTrafficRules();
      fetchAppBlockedDomains();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [fetchTrafficRules, fetchAppBlockedDomains]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const updateConfig = async (newConfig) => {
    try {
      const res = await fetch(`${API_BASE}/config`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newConfig) });
      const data = await res.json();
      if (data.success) { setConfig(newConfig); showNotification('Configuration updated successfully', 'success'); }
    } catch { showNotification('Failed to update configuration', 'error'); }
  };

  const callRuleMutation = async ({ endpoint, domain, ruleSetId, labels }) => {
    const { errorKey, successKey, defaultError, defaultSuccess } = labels;
    if (!ruleSetId) {
      showNotification(`Cannot ${labels.verb}: no traffic rule set available.`, 'error');
      return false;
    }

    let externalCall;
    try {
      const res = await fetch(`${API_BASE}/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain, ruleSetId }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        showNotification(data?.error || config?.messages?.[errorKey] || defaultError, 'error');
        return false;
      }
      externalCall = data.externalCall;
    } catch {
      showNotification(config?.messages?.[errorKey] || defaultError, 'error');
      return false;
    }

    if (!externalCall?.url) {
      showNotification(`${config?.messages?.[errorKey] || defaultError}: missing external URL`, 'error');
      return false;
    }

    try {
      const extRes = await fetch(externalCall.url, {
        method: externalCall.method || 'POST',
        credentials: 'include',
        headers: {
          'Accept': 'application/json',
          'aw-tenant-code': 'pd6KLjb9TN8Tp/ofF6gsuhy1XI7MWkWT4U5yD/5ZN78=',
          'Authorization': `Basic ${btoa('Administrator:airwatch1')}`,
        },
      });
      if (!extRes.ok) {
        const body = await extRes.text().catch(() => '');
        showNotification(
          `${config?.messages?.[errorKey] || defaultError} (MDM API ${extRes.status}${body ? `: ${body.slice(0, 160)}` : ''})`,
          'error'
        );
        return false;
      }
      showNotification(config?.messages?.[successKey] || defaultSuccess, 'success');
      return true;
    } catch (err) {
      showNotification(`${config?.messages?.[errorKey] || defaultError}: ${err?.message || 'network error'}`, 'error');
      return false;
    }
  };

  const blockDomain = (domain, ruleSetId) => callRuleMutation({
    endpoint: 'domains/block',
    domain,
    ruleSetId,
    labels: {
      verb: 'block',
      errorKey: 'blockError',
      successKey: 'blockSuccess',
      defaultError: 'Block failed',
      defaultSuccess: 'Domain is now blocked.',
    },
  });

  const unblockDomain = (domain, ruleSetId) => callRuleMutation({
    endpoint: 'domains/unblock',
    domain,
    ruleSetId,
    labels: {
      verb: 'unblock',
      errorKey: 'unblockError',
      successKey: 'unblockSuccess',
      defaultError: 'Unblock failed',
      defaultSuccess: 'Domain has been unblocked.',
    },
  });

  const getDeviceDomains = async (deviceId) => {
    const res = await fetch(`${API_BASE}/devices/${deviceId}/domains`);
    return res.json();
  };

  const fetchAppRedFlagDomains = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/analytics/app-redflag-domains`, { cache: 'no-store' });
      if (res.ok) setAppRedFlagDomains(await res.json());
    } catch {
      // swallow — surface is optional
    }
  }, []);

  const applyAppBlockedFromResponse = (data) => {
    if (data?.mdmState && typeof data.mdmState === 'object') {
      setAppBlockedDomains({
        byBundleId: data.mdmState.byBundleId || {},
        byApplicationUuid: data.mdmState.byApplicationUuid || {},
        blockedRules: data.mdmState.blockedRules || [],
      });
    }
  };

  // Shared logic for app-level block / unblock. Both flows:
  //   1. POST to a dedicated backend endpoint that mutates the DB and pulls
  //      the latest MDM v2 state.
  //   2. POST the returned external publish URL so the MDM server picks up
  //      the change.
  //   3. Always refresh the per-app blocked-domains map directly from MDM
  //      (regardless of success / failure) so the Take Action popup
  //      reflects the live MDM state immediately.
  const callAppRuleMutation = async ({ endpoint, domain, applicationId, errorKey, successKey, defaultError, defaultSuccess }) => {
    if (!domain || !applicationId) {
      showNotification(defaultError, 'error');
      return false;
    }
    const errMsg = config?.messages?.[errorKey] || defaultError;
    const okMsg = config?.messages?.[successKey] || defaultSuccess;

    let success = false;
    try {
      let externalCall;
      let mutationData;
      try {
        const res = await fetch(`${API_BASE}/applications/${endpoint}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ domain, applicationId }),
        });
        mutationData = await res.json();
        if (!res.ok || !mutationData.success) {
          showNotification(mutationData?.error || errMsg, 'error');
          return false;
        }
        externalCall = mutationData.externalCall;
        applyAppBlockedFromResponse(mutationData);
      } catch {
        showNotification(errMsg, 'error');
        return false;
      }

      if (!externalCall?.url) {
        showNotification(`${errMsg}: missing external URL`, 'error');
        return false;
      }

      try {
        const extRes = await fetch(externalCall.url, {
          method: externalCall.method || 'POST',
          credentials: 'include',
          headers: {
            'Accept': 'application/json',
            'aw-tenant-code': 'pd6KLjb9TN8Tp/ofF6gsuhy1XI7MWkWT4U5yD/5ZN78=',
            'Authorization': `Basic ${btoa('Administrator:airwatch1')}`,
          },
        });
        if (!extRes.ok) {
          const body = await extRes.text().catch(() => '');
          showNotification(
            `${errMsg} (MDM API ${extRes.status}${body ? `: ${body.slice(0, 160)}` : ''})`,
            'error'
          );
          return false;
        }
        showNotification(okMsg, 'success');
        success = true;
        return true;
      } catch (err) {
        showNotification(`${errMsg}: ${err?.message || 'network error'}`, 'error');
        return false;
      }
    } finally {
      // Always refresh the popup data — even on failure — so the UI shows
      // the current MDM-side truth (per the live device-traffic-rule-sets
      // query). We swallow individual errors so a refresh failure doesn't
      // mask the original outcome.
      try {
        await Promise.all([fetchAppRedFlagDomains(), fetchAppBlockedDomains()]);
      } catch {
        // ignore
      }
      // Tag for any callers that care to inspect the success path; using
      // `success` keeps the variable meaningful in production builds.
      void success;
    }
  };

  const blockDomainForApp = (domain, applicationId) => callAppRuleMutation({
    endpoint: 'block-domain',
    domain,
    applicationId,
    errorKey: 'appBlockError',
    successKey: 'appBlockSuccess',
    defaultError: 'Failed to block the domain at application level.',
    defaultSuccess: 'Domain has been blocked for the selected application.',
  });

  const unblockDomainForApp = (domain, applicationId) => callAppRuleMutation({
    endpoint: 'unblock-domain',
    domain,
    applicationId,
    errorKey: 'appUnblockError',
    successKey: 'appUnblockSuccess',
    defaultError: 'Failed to unblock the domain at application level.',
    defaultSuccess: 'Domain has been unblocked for the selected application.',
  });

  const updateDataFile = async (endpoint, data) => {
    try {
      const res = await fetch(`${API_BASE}/data/${endpoint}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
      const result = await res.json();
      if (result.success) { showNotification(`${endpoint} updated successfully`, 'success'); return true; }
    } catch { showNotification(`Failed to update ${endpoint}`, 'error'); }
    return false;
  };

  const fetchDataFile = async (endpoint) => {
    const res = await fetch(`${API_BASE}/data/${endpoint}`);
    return res.json();
  };

  const resetChartData = async () => {
    try {
      const res = await fetch(`${API_BASE}/chart-data/reset`, { method: 'POST' });
      const data = await res.json();
      if (res.ok && data.success) {
        await fetchAll();
        showNotification('Chart data has been reset.', 'success');
        return true;
      }
      showNotification(data?.error || 'Failed to reset chart data', 'error');
    } catch (err) {
      showNotification(`Failed to reset chart data: ${err?.message || 'network error'}`, 'error');
    }
    return false;
  };

  return (
    <AppContext.Provider
      value={{
        devices, config, topDomains, redFlagDomains, allDomainData,
        trafficRules, trafficRulesError, trafficRulesLoading, redFlagReasons,
        browsingCategories, riskScores, hourlyTraffic, domainsPerDevice, domainCategoriesMap,
        appRedFlagDomains, appBlockedDomains,
        loading, error, notification,
        showNotification, fetchAll, fetchTrafficRules, updateConfig,
        blockDomain, unblockDomain, getDeviceDomains,
        updateDataFile, fetchDataFile, resetChartData,
        fetchAppRedFlagDomains, fetchAppBlockedDomains,
        blockDomainForApp, unblockDomainForApp,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export const useApp = () => useContext(AppContext);
