/**
 * Main Layout Component
 * TitleBar at top, then sidebar + content below.
 */
import { Outlet } from 'react-router-dom';
import { useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { TitleBar } from './TitleBar';
import { useSettingsStore } from '@/stores/settings';

export function MainLayout() {
  const location = useLocation();
  const sidebarCollapsed = useSettingsStore((state) => state.sidebarCollapsed);
  const isOnChat = location.pathname === '/';
  const sidebarStripWidth = sidebarCollapsed || !isOnChat ? 72 : 286;

  return (
    <div
      data-testid="main-layout"
      className="app-shell flex h-screen flex-col overflow-hidden bg-background"
    >
      {/* Title bar: drag region on macOS, icon + controls on Windows */}
      <TitleBar sidebarStripWidth={sidebarStripWidth} />

      {/* Below the title bar: sidebar + content */}
      <div className="relative z-10 flex min-h-0 flex-1 overflow-hidden">
        <Sidebar />
        <main data-testid="main-content" className="min-h-0 flex-1 overflow-auto">
          <div className="h-full bg-background">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
