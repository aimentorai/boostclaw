import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useAuthStore } from '@/stores/auth';
import { subscribeHostEvent } from '@/lib/host-events';

type AuthEventPayload = {
  authenticated?: boolean;
  reason?: string;
};

type AuthDebugPayload = {
  step?: string;
  detail?: unknown;
  ts?: number;
};

export function Login() {
  const navigate = useNavigate();
  const enabled = useAuthStore((state) => state.enabled);
  const authenticated = useAuthStore((state) => state.authenticated);
  const pendingLogin = useAuthStore((state) => state.pendingLogin);
  const error = useAuthStore((state) => state.error);
  const profile = useAuthStore((state) => state.profile);
  const login = useAuthStore((state) => state.login);
  const refreshStatus = useAuthStore((state) => state.refreshStatus);
  const clearError = useAuthStore((state) => state.clearError);
  const [debugLogs, setDebugLogs] = useState<string[]>([]);

  const appendLog = (line: string) => {
    const time = new Date().toLocaleTimeString();
    setDebugLogs((prev) => [...prev.slice(-19), `[${time}] ${line}`]);
  };

  useEffect(() => {
    const offStarted = subscribeHostEvent<{ authorizationUrl?: string }>('auth:started', (payload) => {
      appendLog(`已发起登录，授权地址：${payload?.authorizationUrl || '-'}`);
    });
    const offDebug = subscribeHostEvent<AuthDebugPayload>('auth:debug', (payload) => {
      const step = payload?.step || 'debug';
      const detail = payload?.detail ? JSON.stringify(payload.detail) : '{}';
      appendLog(`[${step}] ${detail}`);
    });
    const offSuccess = subscribeHostEvent<AuthEventPayload>('auth:success', async () => {
      appendLog('登录成功，正在刷新状态并进入主界面');
      await refreshStatus();
      navigate('/');
    });
    const offError = subscribeHostEvent<AuthEventPayload>('auth:error', async (payload) => {
      appendLog(`登录失败：${payload?.reason || '未知错误'}`);
      await refreshStatus();
      useAuthStore.setState({
        pendingLogin: false,
        error: payload?.reason || 'Login failed',
      });
    });
    return () => {
      offStarted();
      offDebug();
      offSuccess();
      offError();
    };
  }, [navigate, refreshStatus]);

  useEffect(() => {
    if (enabled && authenticated) {
      navigate('/');
    }
  }, [enabled, authenticated, navigate]);

  useEffect(() => {
    if (!enabled || authenticated || pendingLogin) {
      return;
    }
    clearError();
    appendLog('自动跳转到登录网站');
    void login();
  }, [enabled, authenticated, pendingLogin, clearError, login]);

  return (
    <div
      data-testid="login-page"
      className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-100 via-white to-slate-200 p-6"
    >
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white/95 backdrop-blur p-8 shadow-xl">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">登录 Boostclaw</h1>
        <p className="mt-2 text-sm text-slate-600">
          正在跳转到组织账号登录网站。
        </p>

        <Button
          data-testid="login-start-button"
          className="mt-6 w-full"
          onClick={() => {
            clearError();
            appendLog('点击登录按钮');
            void login();
          }}
          disabled={pendingLogin}
        >
          {pendingLogin ? '正在跳转...' : '重新登录'}
        </Button>

        {error && (
          <p data-testid="login-error" className="mt-4 text-sm text-rose-600 break-all">
            {error}
          </p>
        )}

        {profile?.email && (
          <p className="mt-4 text-xs text-slate-500">
            上次登录账号：{profile.email}
          </p>
        )}

        <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-slate-700">登录调试日志</p>
            <button
              type="button"
              className="text-xs text-slate-500 hover:text-slate-700"
              onClick={() => setDebugLogs([])}
            >
              清空
            </button>
          </div>
          <div
            data-testid="login-debug-log"
            className="mt-2 max-h-36 overflow-auto rounded border border-slate-200 bg-white p-2 text-xs text-slate-700"
          >
            {debugLogs.length === 0 ? '暂无日志' : debugLogs.map((line, index) => (
              <div key={`${line}-${index}`}>{line}</div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
