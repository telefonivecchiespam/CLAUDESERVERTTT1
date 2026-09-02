// Browser App - initBrowser(container)
(function() {
    'use strict';

    // Point this at wherever serverproxy.js is running. Override from index.html
    // with: <script>window.BROWSER_PROXY_URL = 'https://your-proxy-host';</script>
    const PROXY_URL = window.BROWSER_PROXY_URL || '';

    window.initBrowser = function(container, winId) {
        let pendingCleanup = null; // cleans up the previous navigation's timers/listeners, if any

        const wrapper = document.createElement('div');
        wrapper.className = 'browser-wrapper';
        wrapper.style.width = '100%';
        wrapper.style.height = '100%';
        wrapper.style.display = 'flex';
        wrapper.style.flexDirection = 'column';

        // Toolbar
        const toolbar = document.createElement('div');
        toolbar.className = 'browser-toolbar';
        toolbar.style.padding = '5px';
        toolbar.style.background = '#F0F0F0';
        toolbar.style.borderBottom = '1px solid #D0D0D0';
        toolbar.style.display = 'flex';
        toolbar.style.gap = '5px';
        toolbar.style.alignItems = 'center';

        const urlInput = document.createElement('input');
        urlInput.type = 'text';
        urlInput.className = 'browser-url';
        urlInput.value = '';
        urlInput.placeholder = 'Search or enter URL';
        urlInput.style.flex = '1';
        urlInput.style.padding = '4px 8px';
        urlInput.style.border = '1px solid #C0C0C0';
        urlInput.style.borderRadius = '15px';
        urlInput.style.fontSize = '12px';

        const goBtn = document.createElement('button');
        goBtn.textContent = 'Go';
        goBtn.style.padding = '4px 12px';
        goBtn.style.background = '#0078D7';
        goBtn.style.color = '#fff';
        goBtn.style.border = 'none';
        goBtn.style.borderRadius = '15px';
        goBtn.style.cursor = 'pointer';

        function normalizeUrl(raw) {
            let url = raw.trim();
            if (!url) return '';
            if (!url.startsWith('http://') && !url.startsWith('https://')) {
                if (url.includes('.') && !url.includes(' ')) {
                    url = 'https://' + url;
                } else {
                    url = 'https://duckduckgo.com/?q=' + encodeURIComponent(url);
                }
            }
            return url;
        }

        const newTabBtn = document.createElement('button');
        newTabBtn.textContent = '↗';
        newTabBtn.title = 'Open current page in a new browser tab';
        newTabBtn.style.padding = '4px 10px';
        newTabBtn.style.background = '#E0E0E0';
        newTabBtn.style.color = '#333';
        newTabBtn.style.border = '1px solid #C0C0C0';
        newTabBtn.style.borderRadius = '15px';
        newTabBtn.style.cursor = 'pointer';
        newTabBtn.addEventListener('click', () => {
            const url = normalizeUrl(urlInput.value);
            if (!url) return;
            urlInput.value = url;
            window.open(url, '_blank');
            if (window.appLog) window.appLog('INFO_BROWSE', 'Opened in new tab (manual): ' + url);
        });

        toolbar.appendChild(urlInput);
        toolbar.appendChild(goBtn);
        toolbar.appendChild(newTabBtn);
        wrapper.appendChild(toolbar);

        // Content area - start with new tab page
        const contentDiv = document.createElement('div');
        contentDiv.id = 'browser-content';
        contentDiv.style.flex = '1';
        contentDiv.style.overflow = 'hidden';

        function showNewTab() {
            contentDiv.innerHTML = `
                <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%; background:#fff;">
                    <h1 style="font-size:24px; margin-bottom:20px; color:#333;">New Tab</h1>
                    <div style="display:flex; gap:5px;">
                        <input type="text" id="search-input" style="width:300px; padding:8px 12px; border:1px solid #C0C0C0; border-radius:15px; font-size:14px;" placeholder="Search with DuckDuckGo">
                        <button id="search-btn" style="padding:8px 16px; background:#0078D7; color:#fff; border:none; border-radius:15px; cursor:pointer;">Search</button>
                    </div>
                    ${!PROXY_URL ? '<p style="margin-top:10px; font-size:12px; color:#a00;">No proxy configured - pages will open in a new tab instead of inside the browser.</p>' : '<p style="margin-top:10px; font-size:11px; color:#666;">Nota: il server proxy potrebbe essere "addormentato" se inattivo da un po\' (max ogni 12 ore si risveglia da solo) - la prima pagina caricata può richiedere fino a 30-60 secondi.</p>'}
                </div>
            `;
            const searchInput = contentDiv.querySelector('#search-input');
            const searchBtn = contentDiv.querySelector('#search-btn');
            function doSearch() {
                const query = searchInput.value;
                if (query) {
                    urlInput.value = query;
                    navigate();
                }
            }
            searchBtn.addEventListener('click', doSearch);
            searchInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') doSearch();
            });
        }

        function showBlockedMessage(url, reason) {
            contentDiv.innerHTML = `
                <div style="padding:40px; text-align:center; color:#333;">
                    <h2>Unable to load this page</h2>
                    <p>${reason}</p>
                    <button id="open-newtab-btn" style="margin-top:10px; padding:8px 16px; background:#0078D7; color:#fff; border:none; border-radius:4px; cursor:pointer;">
                        Open in new tab instead
                    </button>
                </div>
            `;
            contentDiv.querySelector('#open-newtab-btn').addEventListener('click', () => window.open(url, '_blank'));
        }

        function navigate() {
            const url = normalizeUrl(urlInput.value);
            if (!url) return;
            urlInput.value = url;

            if (pendingCleanup) { pendingCleanup(); pendingCleanup = null; }

            if (!PROXY_URL) {
                // No proxy configured at all - fall back to the old behavior.
                window.open(url, '_blank');
                if (window.appLog) window.appLog('INFO_BROWSE', 'Opened in new tab (no proxy configured): ' + url);
                return;
            }

            const proxiedUrl = PROXY_URL.replace(/\/$/, '') + '/proxy?url=' + encodeURIComponent(url);

            const iframe = document.createElement('iframe');
            iframe.src = proxiedUrl;
            iframe.style.width = '100%';
            iframe.style.height = '100%';
            iframe.style.border = 'none';

            let settled = false;
            let currentIframe = iframe;

            const loadTimeout = setTimeout(() => {
                if (settled) return;
                settled = true;
                showBlockedMessage(url, 'This page is taking too long to load, or the proxy could not reach it.');
                if (window.appLog) window.appLog('ERR_BROWSE', 'Timed out loading: ' + url);
            }, 15000);

            function onProxyMessage(e) {
                if (settled) return;
                if (!e.data || e.data.type !== 'proxy-error') return;
                // Only react to messages from the iframe we're currently showing,
                // in case the user already navigated elsewhere.
                if (e.source !== currentIframe.contentWindow) return;
                settled = true;
                clearTimeout(loadTimeout);
                window.removeEventListener('message', onProxyMessage);
                showBlockedMessage(url, e.data.message || 'The proxy could not load this site.');
                if (window.appLog) window.appLog('ERR_BROWSE', 'Proxy reported an error for: ' + url);
            }
            window.addEventListener('message', onProxyMessage);
            pendingCleanup = () => {
                clearTimeout(loadTimeout);
                window.removeEventListener('message', onProxyMessage);
            };

            iframe.addEventListener('load', () => {
                if (settled) return;
                // The error page's postMessage (if this "successful load" is
                // actually our proxy's error page) was sent synchronously during
                // the iframe's own script execution, which happens before this
                // 'load' event - but message dispatch is still async, so give it
                // a brief moment to arrive before treating this as a real success.
                setTimeout(() => {
                    if (settled) return;
                    settled = true;
                    clearTimeout(loadTimeout);
                    window.removeEventListener('message', onProxyMessage);
                }, 150);
            });
            iframe.addEventListener('error', () => {
                if (settled) return;
                settled = true;
                clearTimeout(loadTimeout);
                window.removeEventListener('message', onProxyMessage);
                showBlockedMessage(url, 'The proxy could not reach this site.');
                if (window.appLog) window.appLog('ERR_BROWSE', 'Proxy failed to load: ' + url);
            });

            contentDiv.innerHTML = '';
            contentDiv.appendChild(iframe);
            if (window.appLog) window.appLog('INFO_BROWSE', 'Navigating (via proxy) to: ' + url);
        }

        goBtn.addEventListener('click', navigate);
        urlInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') navigate();
        });

        wrapper.appendChild(contentDiv);

        // Show new tab page
        showNewTab();

        container.appendChild(wrapper);

        if (window.appLog) window.appLog('INFO_BROWSE', 'Browser initialized');

        if (typeof WindowManager !== 'undefined' && winId) {
            WindowManager.registerCleanup(winId, () => {
                if (pendingCleanup) { pendingCleanup(); pendingCleanup = null; }
            });
        }
    };
})();
