// log.js - App Log Viewer (subscribes to the central appLog store, no monkey-patching)
window.initLog = function(container, winId) {
    if (!container) return;

    container.innerHTML = '';
    container.style.cssText = 'display:flex;flex-direction:column;height:100%;background:#1e1e1e;color:#fff;font-family:monospace;font-size:12px;';

    var toolbar = document.createElement('div');
    toolbar.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:8px 10px;border-bottom:1px solid #333;flex-shrink:0;';

    var header = document.createElement('div');
    header.textContent = '=== Application Log ===';
    header.style.fontWeight = 'bold';

    var clearBtn = document.createElement('span');
    clearBtn.textContent = 'Clear';
    clearBtn.style.cssText = 'cursor:pointer;text-decoration:underline;color:#9cc4ff;';

    toolbar.appendChild(header);
    toolbar.appendChild(clearBtn);
    container.appendChild(toolbar);

    var entriesDiv = document.createElement('div');
    entriesDiv.id = 'log-viewer-entries';
    entriesDiv.style.cssText = 'flex:1;overflow-y:auto;padding:10px;';
    container.appendChild(entriesDiv);

    function pad(n) { return String(n).padStart(2, '0'); }

    function renderEntry(entryData) {
        var entry = document.createElement('div');
        var t = entryData.time instanceof Date ? entryData.time : new Date(entryData.time);
        var stamp = pad(t.getHours()) + ':' + pad(t.getMinutes()) + ':' + pad(t.getSeconds());
        entry.textContent = stamp + '  [' + entryData.code + '] ' + entryData.message;
        entry.style.cssText = 'padding:2px 0;border-bottom:1px solid #333;';

        if (entryData.code && entryData.code.indexOf('ERR') === 0) {
            entry.style.color = '#f48771';
        } else if (entryData.code && entryData.code.indexOf('WARN') === 0) {
            entry.style.color = '#cca700';
        }
        entriesDiv.appendChild(entry);
    }

    function renderAll() {
        entriesDiv.innerHTML = '';
        var history = window.__appLogHistory || [];
        history.forEach(renderEntry);
        entriesDiv.scrollTop = entriesDiv.scrollHeight;
    }

    renderAll();

    // Live updates: subscribe to the central log store instead of wrapping appLog.
    function onNewEntry(entryData) {
        renderEntry(entryData);
        entriesDiv.scrollTop = entriesDiv.scrollHeight;
    }
    window.__appLogListeners = window.__appLogListeners || [];
    window.__appLogListeners.push(onNewEntry);

    clearBtn.addEventListener('click', () => {
        window.__appLogHistory = [];
        entriesDiv.innerHTML = '';
    });

    // Unsubscribe when this Log window is closed, so listeners never pile up.
    if (typeof WindowManager !== 'undefined' && winId) {
        WindowManager.registerCleanup(winId, () => {
            var idx = window.__appLogListeners.indexOf(onNewEntry);
            if (idx !== -1) window.__appLogListeners.splice(idx, 1);
        });
    }
};
