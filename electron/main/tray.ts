/**
 * System Tray Management
 * Creates and manages the system tray icon and menu
 */
import { Tray, Menu, BrowserWindow, app, nativeImage } from 'electron';
import { join } from 'path';
import { getSetting } from '../utils/store';
import { resolveSupportedLanguage, type LanguageCode } from '../../shared/language';

let tray: Tray | null = null;
let trayMainWindow: BrowserWindow | null = null;

const trayI18n: Record<
  LanguageCode,
  {
    appSubtitle: string;
    showApp: string;
    gatewayStatus: string;
    statusRunning: string;
    statusConnecting: string;
    statusStopped: string;
    quickActions: string;
    openChat: string;
    openSettings: string;
    checkUpdates: string;
    quitApp: string;
  }
> = {
  en: {
    appSubtitle: 'AI Assistant',
    showApp: 'Show BoostClaw',
    gatewayStatus: 'Gateway Status',
    statusRunning: 'Running',
    statusConnecting: 'Connecting',
    statusStopped: 'Stopped',
    quickActions: 'Quick Actions',
    openChat: 'Open Chat',
    openSettings: 'Open Settings',
    checkUpdates: 'Check for Updates...',
    quitApp: 'Quit BoostClaw',
  },
  zh: {
    appSubtitle: 'AI 助手',
    showApp: '显示 BoostClaw',
    gatewayStatus: '网关状态',
    statusRunning: '运行中',
    statusConnecting: '连接中',
    statusStopped: '已停止',
    quickActions: '快捷操作',
    openChat: '打开聊天',
    openSettings: '打开设置',
    checkUpdates: '检查更新...',
    quitApp: '退出 BoostClaw',
  },
  ja: {
    appSubtitle: 'AI アシスタント',
    showApp: 'BoostClaw を表示',
    gatewayStatus: 'ゲートウェイ状態',
    statusRunning: '実行中',
    statusConnecting: '接続中',
    statusStopped: '停止',
    quickActions: 'クイックアクション',
    openChat: 'チャットを開く',
    openSettings: '設定を開く',
    checkUpdates: 'アップデートを確認...',
    quitApp: 'BoostClaw を終了',
  },
};

function mapGatewayStatus(status: string, t: (typeof trayI18n)['en']): string {
  const normalized = status.trim().toLowerCase();
  if (normalized === 'running' || normalized === 'connected') return t.statusRunning;
  if (normalized === 'connecting' || normalized === 'starting') return t.statusConnecting;
  if (normalized === 'stopped' || normalized === 'error') return t.statusStopped;
  return status;
}

function buildContextMenu(mainWindow: BrowserWindow, t: (typeof trayI18n)['en'], status: string) {
  const showWindow = () => {
    if (mainWindow.isDestroyed()) return;
    mainWindow.show();
    mainWindow.focus();
  };

  return Menu.buildFromTemplate([
    {
      label: t.showApp,
      click: showWindow,
    },
    {
      type: 'separator',
    },
    {
      label: t.gatewayStatus,
      enabled: false,
    },
    {
      label: `  ${mapGatewayStatus(status, t)}`,
      type: 'checkbox',
      checked: true,
      enabled: false,
    },
    {
      type: 'separator',
    },
    {
      label: t.quickActions,
      submenu: [
        {
          label: t.openChat,
          click: () => {
            if (mainWindow.isDestroyed()) return;
            mainWindow.show();
            mainWindow.webContents.send('navigate', '/');
          },
        },
        {
          label: t.openSettings,
          click: () => {
            if (mainWindow.isDestroyed()) return;
            mainWindow.show();
            mainWindow.webContents.send('navigate', '/settings');
          },
        },
      ],
    },
    {
      type: 'separator',
    },
    {
      label: t.checkUpdates,
      click: () => {
        if (mainWindow.isDestroyed()) return;
        mainWindow.webContents.send('update:check');
      },
    },
    {
      type: 'separator',
    },
    {
      label: t.quitApp,
      click: () => {
        app.quit();
      },
    },
  ]);
}

async function applyTrayLocale(status = 'Running'): Promise<void> {
  if (!tray || !trayMainWindow || trayMainWindow.isDestroyed()) return;
  const languageSetting = await getSetting('language');
  const language = resolveSupportedLanguage(languageSetting, 'en');
  const t = trayI18n[language];
  tray.setToolTip(`BoostClaw - ${t.appSubtitle}`);
  tray.setContextMenu(buildContextMenu(trayMainWindow, t, status));
}

/**
 * Resolve the icons directory path (works in both dev and packaged mode)
 */
function getIconsDir(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'resources', 'icons');
  }
  return join(__dirname, '../../resources/icons');
}

/**
 * Create system tray icon and menu
 */
export function createTray(mainWindow: BrowserWindow): Tray {
  const iconsDir = getIconsDir();

  const iconCandidates =
    process.platform === 'darwin'
      ? [
          // macOS: use app icon and scale down for status bar.
          join(iconsDir, 'icon.png'),
          join(iconsDir, '32x32.png'),
        ]
      : process.platform === 'win32'
        ? [
            // Windows: use ICO first for better quality in tray.
            join(iconsDir, 'icon.ico'),
            join(iconsDir, '32x32.png'),
            join(iconsDir, 'icon.png'),
          ]
        : [join(iconsDir, '32x32.png'), join(iconsDir, 'icon.png')];

  let icon = nativeImage.createFromPath(iconCandidates[0]);
  for (const candidate of iconCandidates) {
    const candidateIcon = nativeImage.createFromPath(candidate);
    if (!candidateIcon.isEmpty()) {
      icon = candidateIcon;
      break;
    }
  }

  if (process.platform === 'darwin') {
    icon = icon.resize({ width: 18, height: 18 });
  } else if (process.platform === 'win32') {
    icon = icon.resize({ width: 16, height: 16 });
  } else {
    icon = icon.resize({ width: 22, height: 22 });
  }

  if (icon.isEmpty()) {
    icon = nativeImage.createFromPath(join(iconsDir, 'icon.png'));
  }

  tray = new Tray(icon);
  trayMainWindow = mainWindow;

  if (process.platform === 'darwin') {
    tray.setIgnoreDoubleClickEvents(true);
    tray.setImage(icon);
    tray.setPressedImage(icon);
  }

  tray.setContextMenu(buildContextMenu(mainWindow, trayI18n.en, 'Running'));
  void applyTrayLocale('Running');

  // Click to show window (Windows/Linux)
  tray.on('click', () => {
    if (mainWindow.isDestroyed()) return;
    if (mainWindow.isVisible()) {
      mainWindow.hide();
    } else {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  // Double-click to show window (Windows)
  tray.on('double-click', () => {
    if (mainWindow.isDestroyed()) return;
    mainWindow.show();
    mainWindow.focus();
  });

  return tray;
}

/**
 * Update tray tooltip with Gateway status
 */
export function updateTrayStatus(status: string): void {
  if (tray) {
    void applyTrayLocale(status);
  }
}

export function refreshTrayLocale(): void {
  void applyTrayLocale();
}

/**
 * Destroy tray icon
 */
export function destroyTray(): void {
  if (tray) {
    tray.destroy();
    tray = null;
  }
  trayMainWindow = null;
}
