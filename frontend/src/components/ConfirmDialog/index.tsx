import { useConfirmStore } from '@/stores/confirmStore';
import './ConfirmDialog.css';

export function ConfirmDialog() {
  const { open, options, handleConfirm, handleCancel } = useConfirmStore();

  if (!open || !options) return null;

  const isDanger = options.variant === 'danger';
  const confirmText = options.confirmText || '确定';
  const cancelText = options.cancelText || '取消';
  const dialogWidth = options.width ? `${options.width}px` : undefined;

  const bodyContent = options.content ?? options.message ?? null;

  return (
    <div className="confirm-overlay" onClick={handleCancel}>
      <div
        className={`confirm-dialog ${options.content ? 'confirm-dialog--rich' : ''}`}
        style={dialogWidth ? { width: dialogWidth } : undefined}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="confirm-dialog-header">
          <div className={`confirm-dialog-icon ${isDanger ? 'confirm-dialog-icon-danger' : 'confirm-dialog-icon-default'}`}>
            {isDanger ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="16" x2="12" y2="12" />
                <line x1="12" y1="8" x2="12.01" y2="8" />
              </svg>
            )}
          </div>
          <div className="confirm-dialog-title">{options.title}</div>
        </div>
        <div className={`confirm-dialog-body ${options.content ? 'confirm-dialog-body--rich' : ''}`}>
          {bodyContent}
        </div>
        <div className="confirm-dialog-footer">
          {cancelText && (
            <button className="confirm-btn confirm-btn-cancel" onClick={handleCancel}>
              {cancelText}
            </button>
          )}
          <button
            className={`confirm-btn confirm-btn-confirm ${isDanger ? 'confirm-btn-confirm-danger' : 'confirm-btn-confirm-default'}`}
            onClick={handleConfirm}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}