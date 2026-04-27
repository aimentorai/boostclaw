import { useEffect } from 'react';
import { useAuthStore } from '@/stores/auth';
import { subscribeHostEvent } from '@/lib/host-events';
import { useTranslation } from 'react-i18next';
import loginLobster from '@/assets/login-lobster.png';

type AuthEventPayload = {
  authenticated?: boolean;
  reason?: string;
};

// Login renders the minimal unauthenticated entry screen and starts the OAuth flow.
export function Login() {
  const { t } = useTranslation('common');
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
      // Temporary: keep the user on the login page after app auth succeeds.
      // This makes it easier to inspect the post-login state without an automatic redirect.
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
  }, [refreshStatus, t]);

  useEffect(() => {
    if (enabled && authenticated) {
      // Temporary: do not auto-redirect authenticated users away from /login.
    }
  }, [enabled, authenticated]);

  return (
    <main
      data-testid="login-page"
      className="relative min-h-screen overflow-hidden bg-[#f8fafb] text-[#1f2430]"
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_31%_10%,rgba(214,248,237,0.62),transparent_28%),radial-gradient(circle_at_72%_7%,rgba(226,239,255,0.72),transparent_34%),linear-gradient(180deg,rgba(255,255,255,0.62),rgba(248,250,251,0.96))]" />

      <section className="relative flex min-h-screen flex-col items-center pt-[11.5vh] text-center">
        <img
          data-testid="login-brand-image"
          src={loginLobster}
          alt="BoostClaw"
          className="h-[240px] w-[260px] select-none object-contain"
          draggable={false}
        />

        <h1
          data-testid="login-title"
          className="-mt-1 text-[30px] font-semibold leading-tight tracking-[-0.03em] text-[#20242d]"
        >
          BoostClaw 你的跨境智能助手
        </h1>
        <p className="mt-3 text-[16px] font-medium tracking-[0.04em] text-[#6f7784]">
          数据、选品、调研、分析...
        </p>

        <button
          type="button"
          data-testid="login-start-button"
          aria-label={pendingLogin ? t('auth.redirecting') : t('auth.startLogin')}
          className="mt-9 h-10 w-40 rounded-full bg-[#111626] text-sm font-semibold text-white shadow-[0_10px_24px_rgba(17,22,38,0.18)] transition duration-200 hover:bg-[#1a2033] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#111626]/30 disabled:cursor-wait disabled:opacity-70"
          onClick={() => {
            clearError();
            void login();
          }}
          disabled={pendingLogin}
        >
          {pendingLogin ? t('auth.redirecting') : '登录'}
        </button>
      </section>

      {error && (
        <p
          data-testid="login-error"
          className="absolute left-1/2 top-[70%] w-[min(420px,calc(100%-48px))] -translate-x-1/2 break-all text-center text-sm text-rose-500"
        >
          {error}
        </p>
      )}

      {profile?.email && (
        <p className="absolute left-1/2 top-[76%] -translate-x-1/2 text-center text-xs text-[#9aa2ae]">
          {t('auth.lastLoginAccount', { email: profile.email })}
        </p>
      )}

      <p
        data-testid="login-brand-footer"
        className="absolute bottom-[12.6%] left-1/2 -translate-x-1/2 text-xs tracking-[0.08em] text-[#c6ccd3]"
      >
        小数汇智科技
      </p>
    </main>
  );
}
