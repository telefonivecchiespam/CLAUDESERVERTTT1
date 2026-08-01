// Simple Notepad App - single shared document (classic Notepad behaviour),
// safe with multiple windows open at once, with autosave + a working Clear/Recycle Bin.
(function() {
    'use strict';

    const STORAGE_KEY = 'notepad_data';
    let autosaveTimer = null;

    window.initNotepad = function(windowContent, winId) {
        const wrapper = document.createElement('div');
        wrapper.className = 'notepad-content';

        const menu = document.createElement('div');
        menu.className = 'notepad-menu';

        const clearBtn = document.createElement('span');
        clearBtn.textContent = 'Clear';
        clearBtn.style.cursor = 'pointer';

        const saveBtn = document.createElement('span');
        saveBtn.textContent = 'Save';
        saveBtn.style.cursor = 'pointer';
        saveBtn.style.marginLeft = '10px';

        const savedIndicator = document.createElement('span');
        savedIndicator.style.marginLeft = '10px';
        savedIndicator.style.fontSize = '11px';
        savedIndicator.style.color = '#2a7a2a';

        menu.appendChild(clearBtn);
        menu.appendChild(saveBtn);
        menu.appendChild(savedIndicator);

        const textarea = document.createElement('textarea');
        textarea.rows = 10;
        textarea.cols = 30;

        wrapper.appendChild(menu);
        wrapper.appendChild(textarea);
        windowContent.appendChild(wrapper);

        // If a Recycle Bin restore is pending, load that text instead of the saved doc.
        if (window.__notepadPrefill !== undefined && window.__notepadPrefill !== null) {
            textarea.value = window.__notepadPrefill;
            window.__notepadPrefill = null;
        } else {
            textarea.value = localStorage.getItem(STORAGE_KEY) || '';
        }

        function doSave(showIndicator) {
            localStorage.setItem(STORAGE_KEY, textarea.value);
            if (showIndicator) {
                savedIndicator.textContent = 'Saved';
                setTimeout(() => { savedIndicator.textContent = ''; }, 1500);
            }
            if (window.appLog) window.appLog('INFO_NOTEPAD', 'Document saved');
        }

        // Autosave a moment after the user stops typing, so work is never lost
        // even if they forget to click Save or just close the window.
        textarea.addEventListener('input', () => {
            clearTimeout(autosaveTimer);
            autosaveTimer = setTimeout(() => doSave(false), 800);
        });

        clearBtn.addEventListener('click', () => {
            if (textarea.value.trim() && window.sendToRecycleBin) {
                window.sendToRecycleBin(textarea.value);
            }
            textarea.value = '';
            doSave(false);
            textarea.focus();
            if (window.appLog) window.appLog('INFO_NOTEPAD', 'Cleared document (moved to Recycle Bin)');
        });

        saveBtn.addEventListener('click', () => doSave(true));

        if (window.appLog) window.appLog('INFO_NOTEPAD', 'Notepad opened');

        if (typeof WindowManager !== 'undefined' && winId) {
            WindowManager.registerCleanup(winId, () => {
                clearTimeout(autosaveTimer);
                doSave(false);
                if (window.appLog) window.appLog('INFO_NOTEPAD', 'Notepad closed');
            });
        }
    };
})();
