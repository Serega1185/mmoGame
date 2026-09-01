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

  // ==========================================================
  // ESC
  // ==========================================================

  win.webContents.on('before-input-event', (event, input) => {
    if (
      input.type === 'keyDown' &&
      input.key === 'Escape'
    ) {
      event.preventDefault();

      win.webContents.executeJavaScript(`
        if (window.__toggleGameSettings) {
          window.__toggleGameSettings();
        }
      `, true);
    }
  });

  // ==========================================================
  // КНОПКА ВЫХОД
  // ==========================================================

  win.webContents.on(
    'console-message',
    (event, level, message) => {
      if (message === '__MY_MMO_EXIT_GAME__') {
        win.close();
      }
    }
  );

  // ==========================================================
  // ЗАГРУЗКА ИГРЫ
  // ==========================================================

  win.loadURL('http://127.0.0.1:43217/');

  // ==========================================================
  // МЕНЮ
  // ==========================================================

  win.webContents.once('did-finish-load', () => {
    win.setFullScreen(true);
    win.setKiosk(true);

    injectSettingsMenu();

    win.show();
    win.focus();
  });
}


// ============================================================
// СОЗДАНИЕ МЕНЮ
// ============================================================

function injectSettingsMenu() {
  const menuCode = `
    (() => {

      if (document.getElementById('electron-settings-overlay')) {
        return;
      }

      // ======================================================
      // HTML
      // ======================================================

      const overlay = document.createElement('div');

      overlay.id = 'electron-settings-overlay';

      overlay.innerHTML = \`

        <div id="electron-settings-window">

          <!-- декоративный болт -->
          <div class="settings-bolt"></div>

          <!-- заголовок -->
          <div class="settings-title">
            НАСТРОЙКИ
          </div>

          <!-- верхняя линия -->
          <div class="settings-line">
            <span></span>
            <b>◆</b>
            <span></span>
          </div>

          <!-- громкость -->
          <div class="volume-title">
            ОБЩАЯ ГРОМКОСТЬ
          </div>

          <div class="volume-container">

            <div class="volume-icon volume-low">
              ◀
            </div>

            <div class="slider-container">

              <input
                id="game-volume-slider"
                type="range"
                min="0"
                max="100"
                value="100"
              />

            </div>

            <div class="volume-icon volume-high">
              ▶
            </div>

          </div>

          <!-- нижняя линия -->
          <div class="settings-line bottom-line">
            <span></span>
            <b>◆</b>
            <span></span>
          </div>

          <!-- выход -->
          <button id="settings-exit-button">
            ВЫХОД
          </button>

        </div>

      \`;

      document.body.appendChild(overlay);


      // ======================================================
      // CSS
      // ======================================================

      const style = document.createElement('style');

      style.textContent = \`

        /* ====================================================
           ЗАТЕМНЕНИЕ ИГРЫ
           ==================================================== */

        #electron-settings-overlay {

          position: fixed;

          left: 0;
          top: 0;
          right: 0;
          bottom: 0;

          width: 100vw;
          height: 100vh;

          display: none;

          align-items: center;
          justify-content: center;

          z-index: 2147483647;

          /*
           * Очень тёмное затемнение.
           * Игра на фоне почти не отвлекает.
           */
          background: rgba(0, 0, 0, 0.78);

          font-family:
            Georgia,
            "Times New Roman",
            serif;

          box-sizing: border-box;

          user-select: none;
        }


        /* ====================================================
           ОКНО НАСТРОЕК
           ==================================================== */

        #electron-settings-window {

          position: relative;

          /*
           * УМЕНЬШЕННЫЙ РАЗМЕР
           */
          width: 650px;
          height: 390px;

          box-sizing: border-box;

          padding: 38px 55px 32px 55px;

          /*
           * ТЁМНЫЙ КОРИЧНЕВЫЙ ЦВЕТ
           */
          background:

            linear-gradient(
              90deg,
              #160c06 0%,
              #211107 50%,
              #160c06 100%
            );

          /*
           * Тонкая золотистая рамка
           */
          border: 2px solid #704518;

          box-shadow:

            0 0 0 3px #0b0603,
            0 0 0 4px #43270f,

            inset 0 0 0 1px #281508,

            inset 0 0 35px rgba(0, 0, 0, 0.85),

            0 15px 50px rgba(0, 0, 0, 0.9);

          color: #b88b43;
        }


        /* ====================================================
           ВНУТРЕННЯЯ РАМКА
           ==================================================== */

        #electron-settings-window::before {

          content: "";

          position: absolute;

          left: 9px;
          right: 9px;

          top: 9px;
          bottom: 9px;

          border: 1px solid #42270f;

          pointer-events: none;
        }


        /* ====================================================
           БОЛТ
           ==================================================== */

        .settings-bolt {

          position: absolute;

          top: 14px;
          right: 14px;

          width: 11px;
          height: 11px;

          border-radius: 50%;

          background:
            radial-gradient(
              circle at 35% 30%,
              #888,
              #444 45%,
              #111 75%
            );

          box-shadow:
            0 1px 3px #000,
            inset 0 1px 1px rgba(255,255,255,0.35);
        }


        /* ====================================================
           ЗАГОЛОВОК
           ==================================================== */

        .settings-title {

          text-align: center;

          font-size: 30px;

          font-weight: bold;

          letter-spacing: 2px;

          color: #c29a50;

          /*
           * Небольшая тень,
           * без яркого свечения
           */
          text-shadow:
            2px 2px 2px #000;

          margin-bottom: 18px;
        }


        /* ====================================================
           ДЕКОРАТИВНЫЕ ЛИНИИ
           ==================================================== */

        .settings-line {

          width: 100%;

          display: flex;

          align-items: center;

          margin-bottom: 30px;
        }

        .settings-line span {

          flex: 1;

          height: 1px;

          background:
            linear-gradient(
              to right,
              transparent,
              #704518
            );
        }

        .settings-line span:last-child {

          background:
            linear-gradient(
              to left,
              transparent,
              #704518
            );
        }

        .settings-line b {

          color: #9b6a2b;

          font-size: 14px;

          margin: 0 8px;

          text-shadow:
            1px 1px 2px #000;
        }


        /* ====================================================
           НАЗВАНИЕ ГРОМКОСТИ
           ==================================================== */

        .volume-title {

          font-size: 20px;

          letter-spacing: 1.5px;

          color: #b88b43;

          margin-bottom: 24px;

          text-shadow:
            2px 2px 2px #000;
        }


        /* ====================================================
           ПОЛЗУНОК
           ==================================================== */

        .volume-container {

          display: flex;

          align-items: center;

          width: 100%;

          gap: 16px;
        }


        .volume-icon {

          width: 25px;

          color: #9b702f;

          font-size: 18px;

          text-align: center;

          text-shadow:
            2px 2px 2px #000;
        }


        .slider-container {

          flex: 1;
        }


        #game-volume-slider {

          width: 100%;

          height: 12px;

          appearance: none;
          -webkit-appearance: none;

          outline: none;

          cursor: pointer;

          background:

            linear-gradient(
              to right,
              #a87830 0%,
              #a87830 var(--volume, 100%),
              #170c05 var(--volume, 100%),
              #170c05 100%
            );

          border: 1px solid #573510;

          box-shadow:
            inset 0 2px 4px rgba(0,0,0,0.9);
        }


        /* Ползунок */

        #game-volume-slider::-webkit-slider-thumb {

          appearance: none;
          -webkit-appearance: none;

          width: 20px;
          height: 20px;

          background:
            linear-gradient(
              135deg,
              #b98b42,
              #654018
            );

          border: 2px solid #241205;

          box-shadow:
            0 0 0 1px #916225,
            2px 2px 4px rgba(0,0,0,0.8);

          transform: rotate(45deg);

          cursor: pointer;
        }


        /* ====================================================
           НИЖНЯЯ ЛИНИЯ
           ==================================================== */

        .bottom-line {

          margin-top: 35px;

          margin-bottom: 25px;
        }


        /* ====================================================
           КНОПКА ВЫХОД
           ==================================================== */

        #settings-exit-button {

          display: block;

          margin: 0 auto;

          width: 190px;

          padding: 12px 20px;

          background:

            linear-gradient(
              to bottom,
              #241307,
              #110803
            );

          border: 1px solid #704518;

          box-shadow:

            inset 0 0 0 1px #1b0c05,

            0 3px 7px rgba(0,0,0,0.7);

          color: #b88b43;

          font-family:
            Georgia,
            "Times New Roman",
            serif;

          font-size: 19px;

          font-weight: bold;

          letter-spacing: 2px;

          text-shadow:
            2px 2px 2px #000;

          cursor: pointer;

          transition:
            background 0.15s,
            border-color 0.15s,
            color 0.15s;
        }


        #settings-exit-button:hover {

          background:

            linear-gradient(
              to bottom,
              #321a09,
              #170a04
            );

          border-color: #97672c;

          color: #d0a45a;
        }


        #settings-exit-button:active {

          transform: translateY(1px);
        }


        /* ====================================================
           ЕСЛИ ЭКРАН МАЛЕНЬКИЙ
           ==================================================== */

        @media (max-width: 750px) {

          #electron-settings-window {

            width: 90vw;

            height: 370px;

            padding:
              35px 40px 30px 40px;
          }

          .settings-title {

            font-size: 26px;
          }

          .volume-title {

            font-size: 18px;
          }
        }

      \`;

      document.head.appendChild(style);


      // ======================================================
      // ГРОМКОСТЬ
      // ======================================================

      const slider =
        document.getElementById(
          'game-volume-slider'
        );


      const savedVolume =
        parseFloat(
          localStorage.getItem(
            'game-master-volume'
          )
        );


      let volume =
        Number.isFinite(savedVolume)
          ? savedVolume
          : 1;


      function updateSlider() {

        const percent =
          volume * 100;

        slider.value = percent;

        slider.style.setProperty(
          '--volume',
          percent + '%'
        );
      }


      function applyVolume() {

        // HTML audio/video
        document
          .querySelectorAll('audio, video')
          .forEach(media => {

            media.volume = volume;

            if (volume === 0) {
              media.muted = true;
            } else {
              media.muted = false;
            }

          });


        // Web Audio master gain
        if (window.__gameMasterGains) {

          window.__gameMasterGains.forEach(
            gain => {

              try {

                gain.gain.value = volume;

              } catch (e) {}

            }
          );
        }


        localStorage.setItem(
          'game-master-volume',
          String(volume)
        );

        updateSlider();
      }


      slider.addEventListener(
        'input',
        () => {

          volume =
            Number(slider.value) / 100;

          applyVolume();

        }
      );


      updateSlider();


      // ======================================================
      // КНОПКА ВЫХОД
      // ======================================================

      document
        .getElementById(
          'settings-exit-button'
        )
        .addEventListener(
          'click',
          () => {

            console.log(
              '__MY_MMO_EXIT_GAME__'
            );

          }
        );


      // ======================================================
      // ОТКРЫТЬ / ЗАКРЫТЬ
      // ======================================================

      window.__toggleGameSettings =
        function() {

          const opened =
            overlay.style.display === 'flex';


          if (opened) {

            overlay.style.display = 'none';

          } else {

            overlay.style.display = 'flex';

            applyVolume();

          }

        };


      window.__closeGameSettings =
        function() {

          overlay.style.display = 'none';

        };

    })();
  `;

  win.webContents.executeJavaScript(
    menuCode,
    true
  );
}


// ============================================================
// ЗАПУСК
// ============================================================

app.whenReady().then(() => {

  createWindow();

  // F11
  globalShortcut.register(
    'F11',
    () => {}
  );

  // DevTools
  globalShortcut.register(
    'CommandOrControl+Shift+I',
    () => {}
  );

});


// ============================================================
// ЗАКРЫТИЕ
// ============================================================

app.on(
  'window-all-closed',
  () => {
    app.quit();
  }
);


// ============================================================
// ОЧИСТКА
// ============================================================

app.on(
  'will-quit',
  () => {
    globalShortcut.unregisterAll();
  }
);