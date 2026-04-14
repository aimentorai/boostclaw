/**
 * System Tray Management
 * Creates and manages the system tray icon and menu
 */
import { Tray, Menu, BrowserWindow, app, nativeImage } from 'electron';
import { join } from 'path';

let tray: Tray | null = null;

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

  if (process.platform === 'darwin') {
    tray.setIgnoreDoubleClickEvents(true);
    tray.setImage(icon);
    tray.setPressedImage(icon);
  }

  // Set tooltip
  tray.setToolTip('BoostClaw - AI Assistant');
  
  const showWindow = () => {
    if (mainWindow.isDestroyed()) return;
    mainWindow.show();
    mainWindow.focus();
  };

  // Create context menu
  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show BoostClaw',
      click: showWindow,
    },
    {
      type: 'separator',
    },
    {
      label: 'Gateway Status',
      enabled: false,
    },
    {
      label: '  Running',
      type: 'checkbox',
      checked: true,
      enabled: false,
    },
    {
      type: 'separator',
    },
    {
      label: 'Quick Actions',
      submenu: [
        {
          label: 'Open Chat',
          click: () => {
            if (mainWindow.isDestroyed()) return;
            mainWindow.show();
            mainWindow.webContents.send('navigate', '/');
          },
        },
        {
          label: 'Open Settings',
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
      label: 'Check for Updates...',
      click: () => {
        if (mainWindow.isDestroyed()) return;
        mainWindow.webContents.send('update:check');
      },
    },
    {
      type: 'separator',
    },
    {
      label: 'Quit BoostClaw',
      click: () => {
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);

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
    tray.setToolTip(`BoostClaw - ${status}`);
  }
}

/**
 * Destroy tray icon
 */
export function destroyTray(): void {
  if (tray) {
    tray.destroy();
    tray = null;
  }
}
