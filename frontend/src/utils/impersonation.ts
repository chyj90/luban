export function getImpersonationState(): { userId: number | null; appId: number | null } {
  const userId = localStorage.getItem('impersonate_user_id');
  const appId = localStorage.getItem('impersonate_app_id');
  return {
    userId: userId ? Number(userId) : null,
    appId: appId ? Number(appId) : null,
  };
}

export function isImpersonating(): boolean {
  return !!localStorage.getItem('impersonate_user_id');
}