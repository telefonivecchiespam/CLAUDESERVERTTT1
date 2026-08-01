// Start Menu - Clean version
(function() {
    var startBtn = document.getElementById('start-btn');
    var startMenu = document.getElementById('start-menu');

    // App log: central persistent store + listeners, so any number of Log
    // windows can subscribe/unsubscribe without wrapping each other.
    window.__appLogHistory = window.__appLogHistory || [];
    window.__appLogListeners = window.__appLogListeners || [];

    window.appLog = function(code, message) {
        var entryData = { code: code, message: message, time: new Date() };
        window.__appLogHistory.push(entryData);
        if (window.__appLogHistory.length > 500) window.__appLogHistory.shift();

        var logEl = document.getElementById('app-log');
        if (logEl) {
            var entry = document.createElement('div');
            entry.textContent = '[' + code + '] ' + message;
            logEl.appendChild(entry);
            logEl.scrollTop = logEl.scrollHeight;
            // Cap the corner widget so it doesn't grow forever
            while (logEl.children.length > 60) logEl.removeChild(logEl.children[1]);
        }

        window.__appLogListeners.forEach(function(fn) {
            try { fn(entryData); } catch (e) { /* ignore broken listener */ }
        });
    };

    function toggleStartMenu() {
        startMenu.classList.toggle('open');
    }

    function closeStartMenu() {
        startMenu.classList.remove('open');
    }

    // Toggle start menu
    startBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        toggleStartMenu();
    });

    // Close when clicking outside
    document.addEventListener('click', function(e) {
        if (!startBtn.contains(e.target) && !startMenu.contains(e.target)) {
            closeStartMenu();
        }
    });

    // Event delegation for menu items
    startMenu.addEventListener('click', function(e) {
        var item = e.target.closest('[data-app]');
        if (!item) return;
        var appId = item.dataset.app;
        if (appId && window.launchApp) {
            window.launchApp(appId);
        }
        closeStartMenu();
    });

    // Launch app
    window.launchApp = function(appId) {
        if (typeof WindowManager === 'undefined') return;

        var titleMap = {
            notepad: 'Notepad',
            browser: 'Browser',
            pinball: 'Pinball',
            solitaire: 'Solitaire',
            minesweeper: 'Minesweeper',
            computer: 'My Computer',
            log: 'App Log',
            recycle: 'Recycle Bin',
            tictactoe: 'Tic Tac Toe',
            chess: 'Chess',
            chat: 'Chat'
        };

        var win = WindowManager.createWindow(appId, titleMap[appId] || 'App', '');
        var winId = win.dataset.winId;
        var contentDiv = win.querySelector('.window-content');
        if (!contentDiv) return;

        // A few apps need more room than the 400x300 default to look right.
        var defaultSizes = { chat: { width: 560, height: 420 }, chess: { width: 480, height: 480 } };
        if (defaultSizes[appId]) {
            win.style.width = defaultSizes[appId].width + 'px';
            win.style.height = defaultSizes[appId].height + 'px';
        }

        var initFnName = 'init' + appId.charAt(0).toUpperCase() + appId.slice(1);
        var initFn = window[initFnName];

        if (typeof initFn === 'function') {
            initFn(contentDiv, winId);
        } else {
            contentDiv.innerHTML = '<p>This app is not yet implemented.</p>';
        }
    };

    // Shutdown
    startMenu.querySelectorAll('.shutdown').forEach(function(el) {
        el.addEventListener('click', function() {
            // Close all windows (runs registered cleanups too)
            if (typeof WindowManager !== 'undefined' && WindowManager.closeAllWindows) {
                WindowManager.closeAllWindows();
            } else {
                document.querySelectorAll('.window').forEach(function(w) { w.remove(); });
            }
            closeStartMenu();
            document.getElementById('taskbar-items').innerHTML = '';
            // Clear app log (keep header)
            var logEl = document.getElementById('app-log');
            if (logEl) {
                logEl.innerHTML = '<div style="font-weight:bold; margin-bottom:5px; border-bottom:1px solid #555;">App Log</div>';
            }
        });
    });

    window.appLog('SYS', 'Windows 7 Clone loaded');
})();
