import { Outlet } from 'react-router-dom';
import { GlobalHeader } from '@/components/GlobalHeader';
import { GlobalLoading } from '@/components/GlobalLoading';
import './AppLayout.css';

export function AppLayout() {
  return (
    <div className="app-layout">
      <GlobalHeader />
      <div className="app-layout-content">
        <Outlet />
      </div>
      <GlobalLoading />
    </div>
  );
}