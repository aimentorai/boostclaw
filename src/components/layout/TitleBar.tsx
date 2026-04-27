/**
 * TitleBar Component
 * macOS: empty drag region (native traffic lights handled by hiddenInset).
 * Windows: drag region with custom minimize/maximize/close controls.
 * Linux: use native window chrome (no custom title bar).
 */
import { useState, useEffect } from 'react';
import { Minus, Square, X, Copy } from 'lucide-react';
import { invokeIpc } from '@/lib/api-client';

interface TitleBarProps {
  sidebarStripWidth?: number;
}

export function TitleBar({ sidebarStripWidth = 0 }: TitleBarProps) {
  const platform = window.electron?.platform;

  if (platform === 'darwin') {
    // macOS: just a drag region, traffic lights are native
    return (
      <div className="drag-region flex h-10 shrink-0 bg-[#f8f9fb]">
        {sidebarStripWidth > 0 && (
          <div
            className="h-full shrink-0 bg-[#eef3ff]"
            style={{ width: sidebarStripWidth }}
          />
        )}
        <div className="h-full min-w-0 flex-1 bg-[#f8f9fb]" />
      </div>
    );
  }

  // Linux keeps the native frame/title bar for better IME compatibility.
  if (platform !== 'win32') {
    return null;
  }

  return <WindowsTitleBar sidebarStripWidth={sidebarStripWidth} />;
}

function WindowsTitleBar({ sidebarStripWidth }: { sidebarStripWidth: number }) {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    // Check initial state
    invokeIpc('window:isMaximized').then((val) => {
      setMaximized(val as boolean);
    });
  }, []);

  const handleMinimize = () => {
    invokeIpc('window:minimize');
  };

  const handleMaximize = () => {
    invokeIpc('window:maximize').then(() => {
      invokeIpc('window:isMaximized').then((val) => {
        setMaximized(val as boolean);
      });
    });
  };

  const handleClose = () => {
    invokeIpc('window:close');
  };

  return (
    <div className="flex h-10 shrink-0 bg-[#f8f9fb]">
      {sidebarStripWidth > 0 && (
        <div
          className="drag-region h-full shrink-0 bg-[#eef3ff]"
          style={{ width: sidebarStripWidth }}
        />
      )}
      <div className="drag-region flex h-full min-w-0 flex-1 items-center justify-end bg-[#f8f9fb]">

        {/* Right: Window Controls */}
        <div className="no-drag flex h-full">
          <button
            onClick={handleMinimize}
            className="flex h-full w-11 items-center justify-center text-muted-foreground transition-colors hover:bg-accent/70"
            title="Minimize"
          >
            <Minus className="h-4 w-4" />
          </button>
          <button
            onClick={handleMaximize}
            className="flex h-full w-11 items-center justify-center text-muted-foreground transition-colors hover:bg-accent/70"
            title={maximized ? 'Restore' : 'Maximize'}
          >
            {maximized ? <Copy className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}
          </button>
          <button
            onClick={handleClose}
            className="flex h-full w-11 items-center justify-center text-muted-foreground transition-colors hover:bg-red-500 hover:text-white"
            title="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
