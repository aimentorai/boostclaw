/**
 * Main Layout Component
 * TitleBar at top, then sidebar + content below.
 */
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { TitleBar } from './TitleBar';

export function MainLayout() {
  return (
    <div data-testid="main-layout" className="app-shell flex h-screen flex-col overflow-hidden bg-background">
      {/* Title bar: drag region on macOS, icon + controls on Windows */}
      <TitleBar />

      {/* Below the title bar: sidebar + content */}
      <div className="relative z-10 flex min-h-0 flex-1 overflow-hidden">
        <Sidebar />
        <main data-testid="main-content" className="min-h-0 flex-1 overflow-auto p-4 md:p-5">
          <div className="panel-surface tech-border h-full rounded-[28px]">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
