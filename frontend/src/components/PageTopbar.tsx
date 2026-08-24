import type { ReactNode } from 'react';
import './PageTopbar.css';

interface PageTopbarProps {
  icon: ReactNode;
  title: ReactNode;
  subtitle: string;
  actions?: ReactNode;
}

export default function PageTopbar({ icon, title, subtitle, actions }: PageTopbarProps) {
  return (
    <div className="page-topbar">
      <div className="page-topbar__left">
        <div className="page-topbar__brand">
          <span className="page-topbar__icon">{icon}</span>
          <div>
            <h2 className="page-topbar__title">{title}</h2>
            <p className="page-topbar__subtitle">{subtitle}</p>
          </div>
        </div>
      </div>
      {actions && <div className="page-topbar__actions">{actions}</div>}
    </div>
  );
}