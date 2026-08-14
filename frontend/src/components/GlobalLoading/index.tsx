import { useLoadingStore } from '@/stores/loadingStore';
import './GlobalLoading.css';

export function GlobalLoading() {
  const loading = useLoadingStore((s) => s.loading);

  if (!loading) return null;

  return (
    <div className="global-loading-overlay">
      <div className="global-loading-spinner">
        <svg className="global-loading-icon" viewBox="0 0 40 40" width="40" height="40">
          <circle cx="20" cy="20" r="16" fill="none" stroke="#e6f4ff" strokeWidth="3" />
          <circle cx="20" cy="20" r="16" fill="none" stroke="#1677ff" strokeWidth="3" strokeLinecap="round" strokeDasharray="100" strokeDashoffset="60" />
        </svg>
        <span className="global-loading-text">加载中</span>
      </div>
    </div>
  );
}