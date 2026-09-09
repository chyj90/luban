import { useState } from 'react';
import { changePassword } from '@/api/auth';
import { encryptSecret } from '@/utils/security';
import './ChangePasswordModal.css';

interface Props {
  open: boolean;
  onClose: () => void;
}

export function ChangePasswordModal({ open, onClose }: Props) {
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (newPassword.length < 6) {
      setError('新密码至少 6 位');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('两次输入的新密码不一致');
      return;
    }
    if (oldPassword === newPassword) {
      setError('新密码不能与原密码相同');
      return;
    }

    setLoading(true);
    try {
      const [encryptedOld, encryptedNew] = await Promise.all([
        encryptSecret(oldPassword),
        encryptSecret(newPassword),
      ]);
      await changePassword({ oldPassword: encryptedOld, newPassword: encryptedNew });
      setSuccess(true);
      setTimeout(() => {
        onClose();
        setSuccess(false);
        setOldPassword('');
        setNewPassword('');
        setConfirmPassword('');
      }, 1500);
    } catch (e: unknown) {
      setError((e as Error)?.message || '修改失败，请重试');
    } finally {
      setLoading(false);
    }
  };

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div className="cpw-overlay" onClick={handleOverlayClick}>
      <div className="cpw-card">
        <h2 className="cpw-title">修改密码</h2>
        <hr className="cpw-divider" />

        {success ? (
          <div className="cpw-success">
            <svg className="cpw-success-icon" width="48" height="48" viewBox="0 0 48 48" fill="none">
              <circle cx="24" cy="24" r="22" fill="#e8f8e8" stroke="#00b42a" strokeWidth="2" />
              <path d="M14 24l7 7 13-13" stroke="#00b42a" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <p className="cpw-success-text">密码修改成功</p>
            <p className="cpw-success-sub">下次登录请使用新密码</p>
          </div>
        ) : (
          <form className="cpw-form" onSubmit={handleSubmit}>
            {error && <div className="cpw-error">{error}</div>}

            <div className="cpw-field">
              <label htmlFor="cpw-old">原密码</label>
              <input
                id="cpw-old"
                type="password"
                value={oldPassword}
                onChange={(e) => setOldPassword(e.target.value)}
                placeholder="请输入原密码"
                required
                autoFocus
              />
            </div>

            <div className="cpw-field">
              <label htmlFor="cpw-new">新密码</label>
              <input
                id="cpw-new"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="至少 6 位"
                required
                minLength={6}
              />
            </div>

            <div className="cpw-field">
              <label htmlFor="cpw-confirm">确认新密码</label>
              <input
                id="cpw-confirm"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="再次输入新密码"
                required
              />
            </div>

            <div className="cpw-actions">
              <button type="button" className="cpw-cancel" onClick={onClose} disabled={loading}>
                取消
              </button>
              <button type="submit" className="cpw-submit" disabled={loading}>
                {loading ? '提交中...' : '确认修改'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}