import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { useLoadingStore } from '@/stores/loadingStore';
import { getApplication } from '@/api/application';
import type { Application } from '@/types/application';
import { AppEditorPage } from '@/pages/AppEditor/AppEditorPage';
import { AppUserPage } from './AppUserPage';

export function AppEntryPage() {
  const { appId } = useParams<{ appId: string }>();
  const { user } = useAuthStore();
  const setGlobalLoading = useLoadingStore((s) => s.setLoading);
  const [app, setApp] = useState<Application | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setGlobalLoading(loading);
  }, [loading, setGlobalLoading]);

  useEffect(() => {
    if (!appId) return;
    setLoading(true);
    getApplication(Number(appId)).then((res) => {
      setApp(res.data);
      setLoading(false);
    }).catch(() => {
      setLoading(false);
    });
  }, [appId]);

  if (loading) return null;

  if (!app) {
    return <div className="appentry-error">应用不存在</div>;
  }

  const isOwner = app.createdBy === user?.id;

  if (isOwner) {
    return <AppEditorPage />;
  }

  return <AppUserPage app={app} />;
}