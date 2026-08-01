// Window Manager - supports multiple instances per app + edge/corner resizing

(function() {
    const container = document.getElementById('window-container');
    let zIndexCounter = 1000;
    let windows = {};       // winId -> window element
    let cleanupFns = {};    // winId -> cleanup function
    let winCounter = 0;

    const MIN_WIDTH = 220;
    const MIN_HEIGHT = 160;

    function createWindow(appId, title, contentHTML) {
        const winId = appId + '-' + (++winCounter);

        const win = document.createElement('div');
        win.className = 'window';
        win.dataset.appId = appId;
        win.dataset.winId = winId;
        win.style.zIndex = ++zIndexCounter;
        win.style.left = (50 + (winCounter % 6) * 25) + 'px';
        win.style.top = (50 + (winCounter % 6) * 25) + 'px';
        win.innerHTML = `
            <div class="window-header">
                <span class="window-title">${title}</span>
                <div class="window-controls">
                    <div class="window-minimize" title="Minimize">−</div>
                    <div class="window-maximize" title="Maximize">□</div>
                    <div class="window-close" title="Close">×</div>
                </div>
            </div>
            <div class="window-content"></div>
        `;
        const contentEl = win.querySelector('.window-content');
        if (contentHTML) contentEl.innerHTML = contentHTML;

        // Resize handles (8 directions)
        ['n','s','e','w','ne','nw','se','sw'].forEach(dir => {
            const handle = document.createElement('div');
            handle.className = 'resize-handle resize-' + dir;
            handle.dataset.dir = dir;
            handle.addEventListener('mousedown', (e) => startResize(e, winId, dir));
            win.appendChild(handle);
        });

        container.appendChild(win);
        windows[winId] = win;
        if (window.appLog) window.appLog('SYS', 'Opened window: ' + title);

        const header = win.querySelector('.window-header');
        const closeBtn = win.querySelector('.window-close');
        const minimizeBtn = win.querySelector('.window-minimize');
        const maximizeBtn = win.querySelector('.window-maximize');

        // Drag
        header.addEventListener('mousedown', (e) => startDrag(e, winId));
        closeBtn.addEventListener('click', () => closeWindow(winId));
        minimizeBtn.addEventListener('click', () => minimizeWindow(winId));
        maximizeBtn.addEventListener('click', () => maximizeWindow(winId));
        win.addEventListener('mousedown', () => bringToFront(winId));

        return win;
    }

    function registerCleanup(winId, cleanupFn) {
        cleanupFns[winId] = cleanupFn;
    }

    function bringToFront(winId) {
        const win = windows[winId];
        if (win) win.style.zIndex = ++zIndexCounter;
    }

    function closeWindow(winId) {
        const win = windows[winId];
        if (!win) return;

        if (typeof cleanupFns[winId] === 'function') {
            try {
                cleanupFns[winId]();
            } catch(e) {
                console.error('Cleanup error for ' + winId + ':', e);
            }
            delete cleanupFns[winId];
        }

        win.remove();
        delete windows[winId];
        if (window.appLog) window.appLog('SYS', 'Closed window: ' + winId);
        const taskItem = document.querySelector(`.taskbar-item[data-win='${winId}']`);
        if (taskItem) taskItem.remove();
    }

    function minimizeWindow(winId) {
        const win = windows[winId];
        if (!win) return;
        win.classList.add('minimized');
        if (window.appLog) window.appLog('SYS', 'Minimized window: ' + winId);
        let taskItem = document.querySelector(`.taskbar-item[data-win='${winId}']`);
        if (!taskItem) {
            const bar = document.getElementById('taskbar-items');
            taskItem = document.createElement('div');
            taskItem.className = 'taskbar-item';
            taskItem.dataset.win = winId;
            taskItem.dataset.app = win.dataset.appId;
            taskItem.textContent = win.querySelector('.window-title').textContent;
            taskItem.addEventListener('click', () => restoreWindow(winId));
            bar.appendChild(taskItem);
        }
    }

    function restoreWindow(winId) {
        const win = windows[winId];
        if (!win) return;
        win.classList.remove('minimized');
        const taskItem = document.querySelector(`.taskbar-item[data-win='${winId}']`);
        if (taskItem) taskItem.remove();
        bringToFront(winId);
    }

    function maximizeWindow(winId) {
        const win = windows[winId];
        if (!win) return;
        if (win.classList.contains('maximized')) {
            win.style.width = win.dataset.prevWidth || '400px';
            win.style.height = win.dataset.prevHeight || '300px';
            win.style.left = win.dataset.prevLeft || '50px';
            win.style.top = win.dataset.prevTop || '50px';
            win.classList.remove('maximized');
        } else {
            win.dataset.prevWidth = win.style.width || '400px';
            win.dataset.prevHeight = win.style.height || '300px';
            win.dataset.prevLeft = win.style.left || '50px';
            win.dataset.prevTop = win.style.top || '50px';
            win.style.top = '0px';
            win.style.left = '0px';
            win.style.width = '100vw';
            win.style.height = 'calc(100vh - 35px)';
            win.classList.add('maximized');
        }
        bringToFront(winId);
    }

    // ===== Drag =====
    let dragData = null;
    function startDrag(e, winId) {
        if (e.target.closest('.window-controls')) return; // don't drag when clicking buttons
        const win = windows[winId];
        if (!win || win.classList.contains('maximized')) return;
        dragData = {
            win,
            offsetX: e.clientX - win.offsetLeft,
            offsetY: e.clientY - win.offsetTop
        };
        document.addEventListener('mousemove', onDrag);
        document.addEventListener('mouseup', endDrag);
    }
    function onDrag(e) {
        if (!dragData) return;
        const {win, offsetX, offsetY} = dragData;
        win.style.left = Math.max(0, e.clientX - offsetX) + 'px';
        win.style.top = Math.max(0, e.clientY - offsetY) + 'px';
    }
    function endDrag() {
        document.removeEventListener('mousemove', onDrag);
        document.removeEventListener('mouseup', endDrag);
        dragData = null;
    }

    // ===== Resize =====
    let resizeData = null;
    function startResize(e, winId, dir) {
        e.stopPropagation();
        e.preventDefault();
        const win = windows[winId];
        if (!win || win.classList.contains('maximized')) return;
        bringToFront(winId);
        const rect = win.getBoundingClientRect();
        resizeData = {
            win, dir,
            startX: e.clientX,
            startY: e.clientY,
            startWidth: rect.width,
            startHeight: rect.height,
            startLeft: win.offsetLeft,
            startTop: win.offsetTop
        };
        document.addEventListener('mousemove', onResize);
        document.addEventListener('mouseup', endResize);
    }
    function onResize(e) {
        if (!resizeData) return;
        const { win, dir, startX, startY, startWidth, startHeight, startLeft, startTop } = resizeData;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;

        let newWidth = startWidth, newHeight = startHeight, newLeft = startLeft, newTop = startTop;

        if (dir.includes('e')) newWidth = Math.max(MIN_WIDTH, startWidth + dx);
        if (dir.includes('s')) newHeight = Math.max(MIN_HEIGHT, startHeight + dy);
        if (dir.includes('w')) {
            newWidth = Math.max(MIN_WIDTH, startWidth - dx);
            newLeft = startLeft + (startWidth - newWidth);
        }
        if (dir.includes('n')) {
            newHeight = Math.max(MIN_HEIGHT, startHeight - dy);
            newTop = startTop + (startHeight - newHeight);
        }

        win.style.width = newWidth + 'px';
        win.style.height = newHeight + 'px';
        win.style.left = newLeft + 'px';
        win.style.top = newTop + 'px';
    }
    function endResize() {
        document.removeEventListener('mousemove', onResize);
        document.removeEventListener('mouseup', endResize);
        resizeData = null;
    }

    function closeAllWindows() {
        Object.keys(windows).forEach(winId => closeWindow(winId));
    }

    window.WindowManager = {
        createWindow,
        bringToFront,
        closeWindow,
        closeAllWindows,
        minimizeWindow,
        maximizeWindow,
        restoreWindow,
        registerCleanup,
        windows
    };
})();
