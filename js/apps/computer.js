// Computer (My Computer) App - initComputer(container)
(function() {
    'use strict';

    // ===== Fake filesystem =====
    // Purely cosmetic tree mimicking a typical Windows layout. Nothing here touches
    // the real disk - browsers can't do that from a web page anyway.
    function folder(children) { return { type: 'folder', children: children || {} }; }
    function file() { return { type: 'file' }; }

    function buildFakeFS() {
        return {
            'Local Disk (C:)': folder({
                'Program Files': folder({
                    'Common Files': folder({}),
                    'Internet Explorer': folder({}),
                    'Windows Defender': folder({})
                }),
                'Program Files (x86)': folder({}),
                'Users': folder({
                    'Public': folder({
                        'Public Desktop': folder({}),
                        'Public Documents': folder({})
                    }),
                    'You': folder({
                        'Desktop': folder({}),
                        'Documents': folder({ 'notes.txt': file() }),
                        'Downloads': folder({}),
                        'Music': folder({}),
                        'Pictures': folder({ 'wallpaper.jpg': file() }),
                        'Videos': folder({})
                    })
                }),
                'Windows': folder({
                    'System32': folder({ 'drivers': folder({}) }),
                    'SysWOW64': folder({}),
                    'Fonts': folder({}),
                    'Temp': folder({})
                }),
                'ProgramData': folder({})
            }),
            'Local Disk (D:)': folder({}),
            'CD Drive (E:)': folder({})
        };
    }

    window.initComputer = function(container, winId) {
        container.innerHTML = '';
        const wrapper = document.createElement('div');
        wrapper.style.cssText = 'height:100%;display:flex;flex-direction:column;font-family:"Segoe UI",sans-serif;font-size:12px;box-sizing:border-box;';
        container.appendChild(wrapper);

        const fs = buildFakeFS();
        let path = []; // array of folder names from the root

        function currentNode() {
            let node = { type: 'folder', children: fs };
            for (const step of path) {
                node = node.children[step];
                if (!node) return { type: 'folder', children: {} };
            }
            return node;
        }

        function goTo(index) {
            path = path.slice(0, index);
            render();
        }

        function enter(name) {
            path.push(name);
            render();
        }

        function render() {
            wrapper.innerHTML = '';

            // Toolbar: back button + breadcrumb
            const toolbar = document.createElement('div');
            toolbar.style.cssText = 'display:flex;align-items:center;gap:6px;padding:6px 8px;border-bottom:1px solid #ccc;background:#f0f0f0;flex-shrink:0;';

            const backBtn = document.createElement('button');
            backBtn.textContent = '⬅ Back';
            backBtn.style.cssText = 'padding:2px 8px;font-size:11px;cursor:pointer;';
            backBtn.disabled = path.length === 0;
            backBtn.style.opacity = backBtn.disabled ? '0.5' : '1';
            backBtn.addEventListener('click', () => goTo(path.length - 1));
            toolbar.appendChild(backBtn);

            const breadcrumb = document.createElement('div');
            breadcrumb.style.cssText = 'white-space:nowrap;overflow-x:auto;';
            const rootCrumb = document.createElement('span');
            rootCrumb.textContent = 'Computer';
            rootCrumb.style.cssText = 'cursor:pointer;text-decoration:underline;color:#0056b3;';
            rootCrumb.addEventListener('click', () => goTo(0));
            breadcrumb.appendChild(rootCrumb);
            path.forEach((step, i) => {
                const sep = document.createElement('span');
                sep.textContent = ' \u203A ';
                breadcrumb.appendChild(sep);
                const crumb = document.createElement('span');
                crumb.textContent = step;
                crumb.style.cssText = i < path.length - 1 ? 'cursor:pointer;text-decoration:underline;color:#0056b3;' : 'font-weight:bold;';
                if (i < path.length - 1) crumb.addEventListener('click', () => goTo(i + 1));
                breadcrumb.appendChild(crumb);
            });
            toolbar.appendChild(breadcrumb);
            wrapper.appendChild(toolbar);

            // Content grid
            const grid = document.createElement('div');
            grid.style.cssText = 'flex:1;overflow-y:auto;padding:10px;display:flex;flex-wrap:wrap;align-content:flex-start;gap:14px;background:#fff;';

            const node = currentNode();
            const entries = Object.keys(node.children);

            if (entries.length === 0) {
                const empty = document.createElement('div');
                empty.textContent = 'This folder is empty.';
                empty.style.cssText = 'opacity:0.6;padding:10px;';
                grid.appendChild(empty);
            } else {
                entries.sort((a, b) => {
                    const aIsFolder = node.children[a].type === 'folder';
                    const bIsFolder = node.children[b].type === 'folder';
                    if (aIsFolder !== bIsFolder) return aIsFolder ? -1 : 1;
                    return a.localeCompare(b);
                }).forEach(name => {
                    const entry = node.children[name];
                    const item = document.createElement('div');
                    item.style.cssText = 'width:80px;text-align:center;cursor:pointer;user-select:none;padding:4px;border-radius:3px;';
                    item.addEventListener('mouseenter', () => item.style.background = '#e0eeff');
                    item.addEventListener('mouseleave', () => item.style.background = 'transparent');

                    const icon = document.createElement('div');
                    icon.style.fontSize = '28px';
                    icon.textContent = entry.type === 'folder' ? '📁' : '📄';

                    const label = document.createElement('div');
                    label.textContent = name;
                    label.style.cssText = 'font-size:11px;word-wrap:break-word;margin-top:2px;';

                    item.appendChild(icon);
                    item.appendChild(label);

                    if (entry.type === 'folder') {
                        item.addEventListener('dblclick', () => enter(name));
                    } else {
                        item.addEventListener('dblclick', () => {
                            alert('"' + name + '" can\'t be opened - this is a simulated filesystem, not a real disk.');
                        });
                    }
                    grid.appendChild(item);
                });
            }

            wrapper.appendChild(grid);
        }

        render();
        if (window.appLog) window.appLog('SYS', 'Computer opened');
    };

    // ===== Recycle Bin =====
    // A real trash: anything cleared from Notepad lands here and can be restored
    // or permanently deleted.
    window.__recycleBin = window.__recycleBin || [];

    window.sendToRecycleBin = function(text, sourceLabel) {
        window.__recycleBin.unshift({
            id: 'r' + Date.now() + Math.random().toString(36).slice(2, 7),
            text: text,
            source: sourceLabel || 'Notepad',
            time: new Date()
        });
        if (window.__recycleBin.length > 50) window.__recycleBin.pop();
        if (window.appLog) window.appLog('INFO_RECYCLE', 'Item moved to Recycle Bin');
        if (window.__recycleBinRefresh) window.__recycleBinRefresh();
    };

    window.initRecycle = function(container, winId) {
        container.innerHTML = '';
        const wrapper = document.createElement('div');
        wrapper.className = 'recycle-wrapper';
        wrapper.style.cssText = 'padding:10px;font-family:"Segoe UI",sans-serif;font-size:12px;height:100%;box-sizing:border-box;display:flex;flex-direction:column;';
        container.appendChild(wrapper);

        function pad(n) { return String(n).padStart(2, '0'); }

        function render() {
            wrapper.innerHTML = '';

            const header = document.createElement('div');
            header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;';
            const title = document.createElement('h2');
            title.textContent = 'Recycle Bin';
            title.style.margin = '0';
            header.appendChild(title);

            if (window.__recycleBin.length > 0) {
                const emptyBtn = document.createElement('button');
                emptyBtn.textContent = 'Empty Recycle Bin';
                emptyBtn.style.cssText = 'padding:3px 10px;font-size:11px;cursor:pointer;';
                emptyBtn.addEventListener('click', () => {
                    window.__recycleBin = [];
                    if (window.appLog) window.appLog('INFO_RECYCLE', 'Recycle Bin emptied');
                    render();
                });
                header.appendChild(emptyBtn);
            }
            wrapper.appendChild(header);

            if (window.__recycleBin.length === 0) {
                const empty = document.createElement('p');
                empty.textContent = 'Recycle Bin is empty.';
                empty.style.opacity = '0.7';
                wrapper.appendChild(empty);
                return;
            }

            const list = document.createElement('div');
            list.style.cssText = 'flex:1;overflow-y:auto;';

            window.__recycleBin.forEach(item => {
                const row = document.createElement('div');
                row.style.cssText = 'border:1px solid #ccc;border-radius:3px;padding:6px;margin-bottom:6px;background:#fff;';

                const meta = document.createElement('div');
                const t = item.time instanceof Date ? item.time : new Date(item.time);
                meta.textContent = item.source + ' — ' + pad(t.getHours()) + ':' + pad(t.getMinutes()) + ':' + pad(t.getSeconds());
                meta.style.cssText = 'font-size:10px;color:#666;margin-bottom:3px;';

                const preview = document.createElement('div');
                const previewText = item.text.length > 80 ? item.text.slice(0, 80) + '…' : item.text;
                preview.textContent = previewText || '(empty)';
                preview.style.cssText = 'white-space:pre-wrap;font-family:monospace;font-size:11px;margin-bottom:5px;max-height:60px;overflow:hidden;';

                const actions = document.createElement('div');

                const restoreBtn = document.createElement('button');
                restoreBtn.textContent = 'Restore';
                restoreBtn.style.cssText = 'padding:2px 8px;font-size:11px;cursor:pointer;margin-right:6px;';
                restoreBtn.addEventListener('click', () => {
                    window.__notepadPrefill = item.text;
                    if (window.launchApp) window.launchApp('notepad');
                    window.__recycleBin = window.__recycleBin.filter(x => x.id !== item.id);
                    if (window.appLog) window.appLog('INFO_RECYCLE', 'Restored item to Notepad');
                    render();
                });

                const deleteBtn = document.createElement('button');
                deleteBtn.textContent = 'Delete';
                deleteBtn.style.cssText = 'padding:2px 8px;font-size:11px;cursor:pointer;';
                deleteBtn.addEventListener('click', () => {
                    window.__recycleBin = window.__recycleBin.filter(x => x.id !== item.id);
                    if (window.appLog) window.appLog('INFO_RECYCLE', 'Permanently deleted item');
                    render();
                });

                actions.appendChild(restoreBtn);
                actions.appendChild(deleteBtn);

                row.appendChild(meta);
                row.appendChild(preview);
                row.appendChild(actions);
                list.appendChild(row);
            });

            wrapper.appendChild(list);
        }

        render();
        window.__recycleBinRefresh = render;

        if (typeof WindowManager !== 'undefined' && winId) {
            WindowManager.registerCleanup(winId, () => {
                if (window.__recycleBinRefresh === render) window.__recycleBinRefresh = null;
            });
        }
    };

    if (window.appLog) window.appLog('SYS', 'Computer app loaded');
})();
