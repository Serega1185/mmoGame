const { app, BrowserWindow, globalShortcut } = require('electron');

let win;

function createWindow() {
  win = new BrowserWindow({
    show: false,

    frame: false,
    fullscreen: true,
    kiosk: true,

    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    closable: true,

    autoHideMenuBar: true,

    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.setMenuBarVisibility(false);

  win.loadURL('http://127.0.0.1:43217/');

  // Показываем окно только после полной загрузки
  win.webContents.once('did-finish-load', () => {
    win.setFullScreen(true);
    win.setKiosk(true);

    win.show();
    win.focus();
  });
}

// Запуск Electron
app.whenReady().then(() => {
  createWindow();

  // Блокируем F11
  globalShortcut.register('F11', () => {});

  // Блокируем DevTools
  globalShortcut.register('CommandOrControl+Shift+I', () => {});
});

// Закрытие приложения
app.on('window-all-closed', () => {
  app.quit();
});

// Очистка горячих клавиш
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});