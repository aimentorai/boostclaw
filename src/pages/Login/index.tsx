import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useAuthStore } from '@/stores/auth';
import { subscribeHostEvent } from '@/lib/host-events';
import { useTranslation } from 'react-i18next';

type AuthEventPayload = {
  authenticated?: boolean;
  reason?: string;
};

export function Login() {
  const { t } = useTranslation('common');
  const navigate = useNavigate();
  const enabled = useAuthStore((state) => state.enabled);
  const authenticated = useAuthStore((state) => state.authenticated);
  const pendingLogin = useAuthStore((state) => state.pendingLogin);
  const error = useAuthStore((state) => state.error);
  const profile = useAuthStore((state) => state.profile);
  const login = useAuthStore((state) => state.login);
  const refreshStatus = useAuthStore((state) => state.refreshStatus);
  const clearError = useAuthStore((state) => state.clearError);

  useEffect(() => {
    const offSuccess = subscribeHostEvent<AuthEventPayload>('auth:success', async () => {
      await refreshStatus();
      navigate('/');
    });
    const offError = subscribeHostEvent<AuthEventPayload>('auth:error', async (payload) => {
      await refreshStatus();
      useAuthStore.setState({
        pendingLogin: false,
        error: payload?.reason || t('auth.loginFailed'),
      });
    });
    return () => {
      offSuccess();
      offError();
    };
  }, [navigate, refreshStatus, t]);

  useEffect(() => {
    if (enabled && authenticated) {
      navigate('/');
    }
  }, [enabled, authenticated, navigate]);

  return (
    <div
      data-testid="login-page"
      className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-100 via-white to-slate-200 p-6"
    >
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white/95 backdrop-blur p-8 shadow-xl">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{t('auth.loginTitle')}</h1>
        <p className="mt-2 text-sm text-slate-600">
          {t('auth.loginDescription')}
        </p>

        <Button
          data-testid="login-start-button"
          className="mt-6 w-full"
          onClick={() => {
            clearError();
            void login();
          }}
          disabled={pendingLogin}
        >
          {pendingLogin ? t('auth.redirecting') : t('auth.startLogin')}
        </Button>

        {error && (
          <p data-testid="login-error" className="mt-4 text-sm text-rose-600 break-all">
            {error}
          </p>
        )}

        {profile?.email && (
          <p className="mt-4 text-xs text-slate-500">
            {t('auth.lastLoginAccount', { email: profile.email })}
          </p>
        )}
      </div>
    </div>
  );
}
