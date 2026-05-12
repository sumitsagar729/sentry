import { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import './Configuration.css';

const DATA_EDITORS = [
  { key: 'master-domains', label: 'Master Domains List', description: 'The list of legitimate domains randomly assigned to devices. One domain per line.', type: 'list' },
  { key: 'redflag-domains', label: 'Red Flag Domains List', description: 'Domains flagged as malicious or dangerous. One domain per line.', type: 'list' },
  { key: 'redflag-reasons', label: 'Red Flag Reasons', description: 'JSON map of domain → array of reasons explaining why each domain is flagged.', type: 'json' },
  { key: 'domain-categories', label: 'Domain Categories', description: 'JSON map of category name → array of domains. Used for the browsing category chart.', type: 'json' },
  { key: 'applications', label: 'Applications (App-Level Blocking)', description: 'List of applications used by the App-Level Red Flag chart. Each entry needs applicationId (UUID), name, path (executable), applicationType, deviceTypeId, and optional icon.', type: 'json' },
];

export default function Configuration() {
  const { config, updateConfig, loading, fetchDataFile, updateDataFile, resetChartData, showNotification } = useApp();
  const [localConfig, setLocalConfig] = useState(null);
  const [hasChanges, setHasChanges] = useState(false);
  const [editorPopup, setEditorPopup] = useState(null);
  const [editorContent, setEditorContent] = useState('');
  const [editorLoading, setEditorLoading] = useState(false);
  const [editorDirty, setEditorDirty] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  const handleResetChartData = async () => {
    setResetting(true);
    try { await resetChartData(); }
    finally { setResetting(false); setConfirmReset(false); }
  };

  useEffect(() => {
    if (config) setLocalConfig(JSON.parse(JSON.stringify(config)));
  }, [config]);

  if (loading || !localConfig) return <div className="config-loading">Loading configuration...</div>;

  const toggleGraph = (key) => {
    setLocalConfig((prev) => ({ ...prev, graphs: { ...prev.graphs, [key]: { ...prev.graphs[key], visible: !prev.graphs[key].visible } } }));
    setHasChanges(true);
  };

  const updateGraphTitle = (key, title) => {
    setLocalConfig((prev) => ({ ...prev, graphs: { ...prev.graphs, [key]: { ...prev.graphs[key], title } } }));
    setHasChanges(true);
  };

  const updateMessage = (key, value) => {
    setLocalConfig((prev) => ({ ...prev, messages: { ...prev.messages, [key]: value } }));
    setHasChanges(true);
  };

  const handleSave = () => { updateConfig(localConfig); setHasChanges(false); };
  const handleReset = () => { setLocalConfig(JSON.parse(JSON.stringify(config))); setHasChanges(false); };

  const openEditor = async (editor) => {
    setEditorLoading(true);
    setEditorPopup(editor);
    try {
      const data = await fetchDataFile(editor.key);
      if (editor.type === 'list') {
        setEditorContent(data.join('\n'));
      } else {
        setEditorContent(JSON.stringify(data, null, 2));
      }
      setEditorDirty(false);
    } catch {
      showNotification('Failed to load data file', 'error');
    } finally {
      setEditorLoading(false);
    }
  };

  const saveEditor = async () => {
    if (!editorPopup) return;
    try {
      let parsed;
      if (editorPopup.type === 'list') {
        parsed = editorContent.split('\n').map((l) => l.trim()).filter(Boolean);
      } else {
        parsed = JSON.parse(editorContent);
      }
      const ok = await updateDataFile(editorPopup.key, parsed);
      if (ok) { setEditorDirty(false); setEditorPopup(null); }
    } catch (e) {
      showNotification(`Invalid format: ${e.message}`, 'error');
    }
  };

  const graphLabels = {
    deviceCount: 'Device Count Chart',
    topDomains: 'Top Visited Domains Chart',
    redFlagDomains: 'Red Flag Domains Chart',
    appRedFlagDomains: 'App-Level Red Flag Domains Chart',
    appDomainPies: 'Top Flagged Domains by App (Pie Charts)',
    browsingCategories: 'Browsing Categories Treemap',
    riskScores: 'Device Risk Scores Chart',
    hourlyTraffic: 'Hourly Traffic (Safe vs Flagged)',
    domainsPerDevice: 'Unique Domains per Device',
    enrollmentTimeline: 'Enrollment Timeline Chart',
    managedVsUnmanaged: 'Managed vs Unmanaged Pie Chart',
    complianceStatus: 'Compliance Status Pie Chart',
  };

  const messageLabels = {
    blockConfirm: 'Block Confirmation Popup',
    unblockConfirm: 'Unblock Confirmation Popup',
    blockSuccess: 'Block Success Notification',
    unblockSuccess: 'Unblock Success Notification',
    blockError: 'Block Error Notification',
    unblockError: 'Unblock Error Notification',
    redFlagWarning: 'Red Flag Warning Message',
    appRedFlagWarning: 'App Red Flag Warning Message',
    appBlockConfirm: 'App-Level Block Confirmation Popup',
    appBlockSuccess: 'App-Level Block Success Notification',
    appBlockError: 'App-Level Block Error Notification',
    appUnblockConfirm: 'App-Level Unblock Confirmation Popup',
    appUnblockSuccess: 'App-Level Unblock Success Notification',
    appUnblockError: 'App-Level Unblock Error Notification',
    noDataAvailable: 'No Data Available Message',
    loadingData: 'Loading Data Message',
    deviceClickInfo: 'Device Chart Click Hint',
    domainClickInfo: 'Domain Chart Click Hint',
  };

  return (
    <div className="configuration">
      <div className="config-header">
        <h2>Dashboard Configuration</h2>
        <div className="config-actions">
          {hasChanges && (
            <>
              <button className="config-btn config-btn-secondary" onClick={handleReset}>Discard Changes</button>
              <button className="config-btn config-btn-primary" onClick={handleSave}>Save Configuration</button>
            </>
          )}
        </div>
      </div>

      <div className="config-section">
        <h3>Chart Data</h3>
        <p className="config-description">Dashboard charts use a persisted snapshot that drifts slightly on each refresh (small visit-count bumps, occasional new domains). Reset regenerates the snapshot from scratch.</p>
        <div className="data-editor-cards">
          <div className="data-editor-card">
            <div className="data-editor-info">
              <span className="data-editor-label">Reset Chart Data</span>
              <span className="data-editor-desc">Wipe the current chart snapshot and generate fresh values for all devices.</span>
            </div>
            {confirmReset ? (
              <div className="editor-actions">
                <button className="config-btn config-btn-secondary" disabled={resetting} onClick={() => setConfirmReset(false)}>Cancel</button>
                <button className="config-btn config-btn-danger" disabled={resetting} onClick={handleResetChartData}>{resetting ? 'Resetting…' : 'Confirm Reset'}</button>
              </div>
            ) : (
              <button className="config-btn config-btn-danger" onClick={() => setConfirmReset(true)}>Reset</button>
            )}
          </div>
        </div>
      </div>

      <div className="config-section">
        <h3>Data Files</h3>
        <p className="config-description">Edit the domain lists, red flag reasons, and category mappings used by the dashboard.</p>
        <div className="data-editor-cards">
          {DATA_EDITORS.map((editor) => (
            <div key={editor.key} className="data-editor-card">
              <div className="data-editor-info">
                <span className="data-editor-label">{editor.label}</span>
                <span className="data-editor-desc">{editor.description}</span>
              </div>
              <button className="config-btn config-btn-primary" onClick={() => openEditor(editor)}>Edit</button>
            </div>
          ))}
        </div>
      </div>

      <div className="config-section">
        <h3>Graph Visibility & Titles</h3>
        <p className="config-description">Toggle charts on/off and customize their display titles.</p>
        <div className="config-cards">
          {Object.entries(localConfig.graphs).map(([key, graph]) => (
            <div key={key} className={`config-card ${!graph.visible ? 'config-card-disabled' : ''}`}>
              <div className="config-card-header">
                <span className="config-card-label">{graphLabels[key] || key}</span>
                <label className="toggle-switch">
                  <input type="checkbox" checked={graph.visible} onChange={() => toggleGraph(key)} />
                  <span className="toggle-slider" />
                </label>
              </div>
              <div className="config-card-body">
                <label className="config-field-label">Title</label>
                <input type="text" className="config-input" value={graph.title} onChange={(e) => updateGraphTitle(key, e.target.value)} disabled={!graph.visible} />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="config-section">
        <h3>Popup & Notification Messages</h3>
        <p className="config-description">Customize all messages shown in confirmation dialogs, notifications, and hints.</p>
        <div className="config-messages">
          {Object.entries(localConfig.messages).map(([key, value]) => (
            <div key={key} className="config-message-field">
              <label className="config-field-label">{messageLabels[key] || key}</label>
              <textarea className="config-textarea" value={value} onChange={(e) => updateMessage(key, e.target.value)} rows={2} />
            </div>
          ))}
        </div>
      </div>

      {editorPopup && (
        <div className="modal-overlay" onClick={() => !editorDirty && setEditorPopup(null)}>
          <div className="popup-editor" onClick={(e) => e.stopPropagation()}>
            <div className="popup-header">
              <div>
                <h3>{editorPopup.label}</h3>
                <p className="popup-subtitle">{editorPopup.description}</p>
              </div>
              <button className="detail-close" onClick={() => setEditorPopup(null)}>✕</button>
            </div>
            <div className="popup-editor-body">
              {editorLoading ? (
                <div className="config-loading">Loading...</div>
              ) : (
                <textarea
                  className="editor-textarea"
                  value={editorContent}
                  onChange={(e) => { setEditorContent(e.target.value); setEditorDirty(true); }}
                  spellCheck={false}
                />
              )}
            </div>
            <div className="popup-editor-footer">
              <span className="editor-hint">
                {editorPopup.type === 'list' ? 'One domain per line' : 'Must be valid JSON'}
              </span>
              <div className="editor-actions">
                <button className="config-btn config-btn-secondary" onClick={() => setEditorPopup(null)}>Cancel</button>
                <button className="config-btn config-btn-primary" onClick={saveEditor} disabled={!editorDirty}>Save</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
