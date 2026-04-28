/**
 * Root Application Component
 * Handles routing and global providers
 */
import { Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import { Component, Suspense, useEffect, lazy, useState } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { toast, Toaster } from 'sonner';
import i18n from './i18n';
import { MainLayout } from './components/layout/MainLayout';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Chat } from './pages/Chat';
import { useSettingsStore } from './stores/settings';
import { useGatewayStore } from './stores/gateway';
import { useProviderStore } from './stores/providers';
import { applyGatewayTransportPreference } from './lib/api-client';
import { rendererTimer } from './lib/startup-timer';
import { useAuthStore } from './stores/auth';
import { subscribeHostEvent } from './lib/host-events';

const Models = lazy(() => import('./pages/Models'));
const Agents = lazy(() => import('./pages/Agents'));
const Experts = lazy(() => import('./pages/Experts'));
const Channels = lazy(() => import('./pages/Channels'));
const Skills = lazy(() => import('./pages/Skills'));
const Cron = lazy(() => import('./pages/Cron'));
const Settings = lazy(() => import('./pages/Settings'));
const Setup = lazy(() => import('./pages/Setup'));
const McpServers = lazy(() => import('./pages/McpServers'));
const Login = lazy(() => import('./pages/Login').then((m) => ({ default: m.Login })));

/**
 * Error Boundary to catch and display React rendering errors
 */
class ErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('React Error Boundary caught error:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            padding: '40px',
            color: '#f87171',
            background: '#0f172a',
            minHeight: '100vh',
            fontFamily: 'monospace',
          }}
        >
          <h1 style={{ fontSize: '24px', marginBottom: '16px' }}>Something went wrong</h1>
          <pre
            style={{
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
              background: '#1e293b',
              padding: '16px',
              borderRadius: '8px',
              fontSize: '14px',
            }}
          >
            {this.state.error?.message}
            {'\n\n'}
            {this.state.error?.stack}
          </pre>
          <button
            onClick={() => {
              this.setState({ hasError: false, error: null });
              window.location.reload();
            }}
            style={{
              marginTop: '16px',
              padding: '8px 16px',
              background: '#3b82f6',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
            }}
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const initSettings = useSettingsStore((state) => state.init);
  const theme = useSettingsStore((state) => state.theme);
  const language = useSettingsStore((state) => state.language);
  const initGateway = useGatewayStore((state) => state.init);
  const initProviders = useProviderStore((state) => state.init);
  const initAuth = useAuthStore((state) => state.init);
  const refreshAuthStatus = useAuthStore((state) => state.refreshStatus);
  const authEnabled = useAuthStore((state) => state.enabled);
  const authLoading = useAuthStore((state) => state.loading);
  const authenticated = useAuthStore((state) => state.authenticated);
  const pendingLogin = useAuthStore((state) => state.pendingLogin);

  // loginFlowActive: latches to true when auth:success fires (OAuth completed
  // in external browser/auth window). The /login page itself stays clean while
  // the user is doing OAuth. Overlay only appears for post-login operations
  // (fetching session, quotas, MCP config, etc.) until navigation to main page.
  const [loginFlowActive, setLoginFlowActive] = useState(false);

  // Clear overlay when the user lands on any page other than /login.
  useEffect(() => {
    if (!location.pathname.startsWith('/login')) {
      setLoginFlowActive(false);
    }
  }, [location.pathname]);

  useEffect(() => {
    rendererTimer.mark('renderer_mount');
  }, []);

  useEffect(() => {
    initSettings();
  }, [initSettings]);

  // Sync i18n language with persisted settings on mount
  useEffect(() => {
    if (language && language !== i18n.language) {
      i18n.changeLanguage(language);
    }
  }, [language]);

  // Initialize Gateway connection on mount
  useEffect(() => {
    initGateway();
  }, [initGateway]);

  // Initialize provider snapshot on mount
  useEffect(() => {
    initProviders();
  }, [initProviders]);

  useEffect(() => {
    void initAuth();
  }, [initAuth]);

  useEffect(() => {
    if (authLoading || !authEnabled) {
      return;
    }
    const onLoginPage = location.pathname.startsWith('/login');
    if (!authenticated && !onLoginPage) {
      navigate('/login');
      return;
    }
    if (authenticated && onLoginPage) {
      // Temporary: keep the renderer on /login after sign-in for debugging.
    }
  }, [authLoading, authEnabled, authenticated, location.pathname, navigate]);

  // Listen for navigation events from main process
  useEffect(() => {
    const handleNavigate = (...args: unknown[]) => {
      const path = args[0];
      if (typeof path === 'string') {
        navigate(path);
      }
    };

    if (!window.electron?.ipcRenderer) return;
    const unsubscribe = window.electron.ipcRenderer.on('navigate', handleNavigate);

    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, [navigate]);

  // Apply theme
  useEffect(() => {
    const root = window.document.documentElement;
    root.classList.remove('light', 'dark');

    if (theme === 'system') {
      const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light';
      root.classList.add(systemTheme);
    } else {
      root.classList.add(theme);
    }
  }, [theme]);

  useEffect(() => {
    applyGatewayTransportPreference();
  }, []);

  useEffect(() => {
    rendererTimer.mark('routes_rendered');
    rendererTimer.complete();
  }, []);

  useEffect(() => {
    const offSuccess = subscribeHostEvent<{
      authenticated?: boolean;
      profile?: {
        email?: string;
        subject?: string;
        scope?: string;
        expiresAt?: number;
      };
    }>('auth:success', (payload) => {
      useAuthStore.setState((state) => ({
        authenticated: true,
        pendingLogin: false,
        error: null,
        profile: payload?.profile ?? state.profile,
      }));
      // OAuth completed in the external browser/auth window. Start the
      // post-login overlay now: it covers session fetching, quota loading,
      // MCP config sync, and the final navigation to the main page.
      setLoginFlowActive(true);
      toast.success(i18n.t('auth.loginSucceeded', { ns: 'common' }));
      void refreshAuthStatus();
    });

    const offError = subscribeHostEvent<{ reason?: string }>('auth:error', (payload) => {
      useAuthStore.setState({
        pendingLogin: false,
        error: payload?.reason || null,
      });
      void refreshAuthStatus();
    });

    return () => {
      offSuccess();
      offError();
    };
  }, [refreshAuthStatus]);

  useEffect(() => {
    const offAuthDebug = subscribeHostEvent<{
      step?: string;
      detail?: Record<string, unknown>;
      ts?: number;
    }>('auth:debug', (payload) => {
      console.info('[auth:debug]', payload);
    });

    return () => {
      offAuthDebug();
    };
  }, []);

  return (
    <ErrorBoundary>
      <TooltipProvider delayDuration={300}>
        <Suspense
          fallback={
            <div className="flex h-screen items-center justify-center">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-slate-300 border-t-slate-900" />
            </div>
          }
        >
          <Routes>
            <Route path="/login" element={<Login />} />

            {/* Setup wizard (shown on first launch) */}
            <Route path="/setup/*" element={<Setup />} />

            {/* Main application routes */}
            <Route element={<MainLayout />}>
              <Route path="/" element={<Chat />} />
              <Route path="/models" element={<Models />} />
              <Route path="/agents" element={<Agents />} />
              <Route path="/experts" element={<Experts />} />
              <Route path="/channels" element={<Channels />} />
              <Route path="/skills" element={<Skills />} />
              <Route path="/cron" element={<Cron />} />
              <Route path="/mcp" element={<McpServers />} />
              <Route path="/settings/*" element={<Settings />} />
            </Route>
          </Routes>
        </Suspense>

        {/* Global toast notifications */}
        <Toaster position="bottom-right" richColors closeButton style={{ zIndex: 99999 }} />

        {/* Full-screen login overlay.
            loginFlowActive latches true when the login button is pressed and
            stays true until the user leaves /login — covering the full window:
            OAuth wait → auth:success → post-login operations → redirect. */}
        {/* Post-login overlay: shown after auth:success fires (OAuth done in
            external browser) and stays until the user lands on the main page.
            Covers session/quota/MCP fetching and the navigate transition. */}
        {authEnabled && loginFlowActive && (
          <div className="fixed inset-0 z-[99998] flex items-center justify-center bg-black/30 backdrop-blur-sm">
            <div className="rounded-2xl border border-slate-200 bg-white px-8 py-6 shadow-xl text-center min-w-[220px]">
              <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-green-300 border-t-green-600" />
              <p className="text-base font-semibold text-slate-900">
                {i18n.t('common:auth.loginSucceededTitle')}
              </p>
              <p className="mt-2 text-sm text-slate-600">
                {i18n.t('common:auth.loginSucceededDesc')}
              </p>
            </div>
          </div>
        )}
      </TooltipProvider>
    </ErrorBoundary>
  );
}

export default App;
