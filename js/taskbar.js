// Taskbar
// Manages open windows display and clock

(function() {
    const taskbarItems = document.getElementById('taskbar-items');
    const clock = document.getElementById('clock');
    const startMenu = document.getElementById('start-menu');

    // Update clock every second
    function updateClock() {
        const now = new Date();
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        clock.textContent = `${hours}:${minutes}`;
    }
    setInterval(updateClock, 1000);
    updateClock();

    // Handle window focus/activation
    document.addEventListener('click', (e) => {
        const winEl = e.target.closest('.window');
        if (winEl) {
            const winId = winEl.dataset.winId;
            if (winId) {
                // Update active state
                document.querySelectorAll('.taskbar-item').forEach(item => {
                    item.classList.toggle('active', item.dataset.win === winId);
                });
            }
        }
    });

    // Minimize all windows on taskbar click (if not clicking a specific app)
    taskbarItems.addEventListener('click', (e) => {
        if (e.target === taskbarItems) {
            // Minimize all windows
            document.querySelectorAll('.window').forEach(win => {
                if (!win.classList.contains('minimized')) {
                    const winId = win.dataset.winId;
                    if (winId && typeof WindowManager !== 'undefined') {
                        WindowManager.minimizeWindow(winId);
                    }
                }
            });
        }
    });
})();
