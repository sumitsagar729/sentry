import './ConfirmModal.css';

export default function ConfirmModal({
  title,
  message,
  onConfirm,
  onCancel,
  confirmLabel = 'Confirm',
  danger = false,
  loading = false,
  loadingLabel = 'Working…',
  loadingMessage,
}) {
  const handleOverlayClick = () => { if (!loading) onCancel(); };
  return (
    <div className="modal-overlay" onClick={handleOverlayClick}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">{title}</div>
        <div className="modal-body">
          {message}
          {loading && (
            <div className="modal-loading-row">
              <span className="modal-spinner" />
              <span>{loadingMessage || 'Contacting MDM server…'}</span>
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="modal-btn modal-btn-cancel" onClick={onCancel} disabled={loading}>Cancel</button>
          <button
            className={`modal-btn ${danger ? 'modal-btn-danger' : 'modal-btn-primary'}`}
            onClick={onConfirm}
            disabled={loading}
          >
            {loading ? (
              <span className="modal-btn-loading">
                <span className="modal-spinner modal-spinner-light" />
                {loadingLabel}
              </span>
            ) : (
              confirmLabel
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
