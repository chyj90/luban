import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { register as registerApi } from '@/api';
import './LoginPage.css';

export function RegisterPage() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await registerApi({ name, email, password });
      navigate('/login');
    } catch {
      setError('注册失败，请稍后重试');
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
        <h2 className="login-title">注册</h2>

        {error && <div className="login-error">{error}</div>}

        <form className="login-form" onSubmit={handleRegister}>
          <div className="login-field">
            <label htmlFor="name">用户名</label>
            <input
              id="name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="请输入用户名"
              required
              minLength={2}
              maxLength={30}
            />
          </div>
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
              placeholder="请输入密码，至少6位"
              required
              minLength={6}
            />
          </div>
          <button type="submit" className="login-submit" disabled={loading}>
            {loading ? '注册中...' : '注册'}
          </button>
        </form>

        <div className="login-footer">
          已有账号？<Link to="/login">立即登录</Link>
        </div>
      </div>
    </div>
  );
}