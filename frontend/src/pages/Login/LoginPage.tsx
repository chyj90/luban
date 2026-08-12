import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { login } from '@/api';
import { useAuthStore } from '@/stores/authStore';
import './LoginPage.css';

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const setAuth = useAuthStore((s) => s.setAuth);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await login({ email, password });
      setAuth(res.data.token, res.data.user);
      navigate('/workspace');
    } catch {
      setError('登录失败，请检查邮箱和密码');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-container">
      <div className="login-card">
        <div className="login-logo">
          <h1>鲁班</h1>
          <p>AI 驱动应用构建平台</p>
        </div>
        <h2 className="login-title">登录</h2>

        {error && <div className="login-error">{error}</div>}

        <form className="login-form" onSubmit={handleLogin}>
          <div className="login-field">
            <label htmlFor="email">邮箱</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="请输入邮箱"
              required
            />
          </div>
          <div className="login-field">
            <label htmlFor="password">密码</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="请输入密码"
              required
            />
          </div>
          <button type="submit" className="login-submit" disabled={loading}>
            {loading ? '登录中...' : '登录'}
          </button>
        </form>

        <div className="login-footer">
          还没有账号？<Link to="/register">立即注册</Link>
        </div>
      </div>
    </div>
  );
}