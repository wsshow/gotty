import { useState } from 'preact/hooks';

interface LoginProps {
    onSuccess: (token: string) => void;
}

export const Login = ({ onSuccess }: LoginProps) => {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e: Event) => {
        e.preventDefault();
        setError(null);
        setLoading(true);

        try {
            const credentials = btoa(`${username}:${password}`);
            const response = await fetch('api/auth/verify', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Basic ${credentials}`
                }
            });

            if (!response.ok) {
                throw new Error('认证失败，请检查用户名和密码');
            }

            const data = await response.json();
            if (data.success) {
                // Store credentials in sessionStorage
                sessionStorage.setItem('gotty_auth', credentials);
                onSuccess(credentials);
            } else {
                throw new Error('认证失败');
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : '登录失败，请重试');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="login-overlay">
            <div className="login-container">
                <div className="login-header">
                    <h1>登录</h1>
                </div>

                <form className="login-form" onSubmit={handleSubmit}>
                    {error && (
                        <div className="login-error">
                            <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" />
                            </svg>
                            {error}
                        </div>
                    )}

                    <div className="login-field">
                        <label htmlFor="username">
                            <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                                <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
                            </svg>
                            <span>用户名</span>
                        </label>
                        <input
                            id="username"
                            type="text"
                            value={username}
                            onInput={(e) => setUsername((e.target as HTMLInputElement).value)}
                            placeholder="请输入用户名"
                            disabled={loading}
                            autoComplete="username"
                            required
                        />
                    </div>

                    <div className="login-field">
                        <label htmlFor="password">
                            <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                                <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z" />
                            </svg>
                            <span>密码</span>
                        </label>
                        <input
                            id="password"
                            type="password"
                            value={password}
                            onInput={(e) => setPassword((e.target as HTMLInputElement).value)}
                            placeholder="请输入密码"
                            disabled={loading}
                            autoComplete="current-password"
                            required
                        />
                    </div>

                    <button type="submit" className="login-btn" disabled={loading}>
                        {loading ? '登录中...' : '登录'}
                    </button>
                </form>
            </div>
        </div>
    );
};
