// Browser App - initBrowser(container)
(function() {
    'use strict';

    function loadJSON(key, fallback) {
        try {
            const raw = localStorage.getItem(key);
            return raw ? JSON.parse(raw) : fallback;
        } catch (e) { return fallback; }
    }
    function saveJSON(key, value) {
        try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* ignore (private mode, quota, etc.) */ }
    }

    window.initBrowser = function(container, winId) {
        // Point this at wherever serverproxy.js is running. Override from index.html
        // with: <script>window.BROWSER_PROXY_URL = 'https://your-proxy-host';</script>
        // Read lazily (at app-open time, not script-load time) so it works no
        // matter what order the <script> tags happen to be in.
        const PROXY_URL = window.BROWSER_PROXY_URL || '';

        let pendingCleanup = null; // cleans up the current navigation's timers/listeners, if any
        let history = [];          // array of visited URLs
        let historyIndex = -1;
        let skipNextHistoryPush = false; // set when navigating via Back/Forward/Reload

        let bookmarks = loadJSON('browser_bookmarks_v1', []);   // [{url}]
        let recentSites = loadJSON('browser_recent_v1', []);    // [{url, time}]

        const wrapper = document.createElement('div');
        wrapper.className = 'browser-wrapper';
        wrapper.style.width = '100%';
        wrapper.style.height = '100%';
        wrapper.style.display = 'flex';
        wrapper.style.flexDirection = 'column';

        // ===== Toolbar =====
        const toolbar = document.createElement('div');
        toolbar.className = 'browser-toolbar';
        toolbar.style.padding = '5px';
        toolbar.style.background = '#F0F0F0';
        toolbar.style.borderBottom = '1px solid #D0D0D0';
        toolbar.style.display = 'flex';
        toolbar.style.gap = '5px';
        toolbar.style.alignItems = 'center';

        function navBtn(label, title) {
            const btn = document.createElement('button');
            btn.textContent = label;
            btn.title = title;
            btn.style.padding = '4px 9px';
            btn.style.background = '#E0E0E0';
            btn.style.color = '#333';
            btn.style.border = '1px solid #C0C0C0';
            btn.style.borderRadius = '15px';
            btn.style.cursor = 'pointer';
            return btn;
        }

        const backBtn = navBtn('◀', 'Back');
        const forwardBtn = navBtn('▶', 'Forward');
        const reloadBtn = navBtn('⟳', 'Reload');

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

        const starBtn = navBtn('☆', 'Bookmark this page');

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

        toolbar.appendChild(backBtn);
        toolbar.appendChild(forwardBtn);
        toolbar.appendChild(reloadBtn);
        toolbar.appendChild(urlInput);
        toolbar.appendChild(starBtn);
        toolbar.appendChild(goBtn);
        toolbar.appendChild(newTabBtn);
        wrapper.appendChild(toolbar);

        // ===== Loading indicator (thin bar under the toolbar) =====
        const loadingBar = document.createElement('div');
        loadingBar.style.height = '3px';
        loadingBar.style.width = '100%';
        loadingBar.style.background = 'linear-gradient(90deg, #0078D7, #7EC1FF, #0078D7)';
        loadingBar.style.backgroundSize = '200% 100%';
        loadingBar.style.animation = 'browserLoadingBar 1s linear infinite';
        loadingBar.style.display = 'none';
        const styleTag = document.createElement('style');
        styleTag.textContent = '@keyframes browserLoadingBar { 0% { background-position: 0% 0; } 100% { background-position: -200% 0; } }';
        document.head.appendChild(styleTag);
        wrapper.appendChild(loadingBar);
        function setLoading(on) { loadingBar.style.display = on ? 'block' : 'none'; }

        // ===== Content area =====
        const contentDiv = document.createElement('div');
        contentDiv.id = 'browser-content';
        contentDiv.style.flex = '1';
        contentDiv.style.overflow = 'hidden';

        function isBookmarked(url) { return bookmarks.some(b => b.url === url); }
        function updateStarBtn() {
            const url = urlInput.value.trim();
            starBtn.textContent = url && isBookmarked(url) ? '★' : '☆';
        }
        function toggleBookmark() {
            const url = urlInput.value.trim();
            if (!url) return;
            if (isBookmarked(url)) {
                bookmarks = bookmarks.filter(b => b.url !== url);
            } else {
                bookmarks.unshift({ url });
                if (bookmarks.length > 30) bookmarks.pop();
            }
            saveJSON('browser_bookmarks_v1', bookmarks);
            updateStarBtn();
        }
        starBtn.addEventListener('click', toggleBookmark);

        function addRecent(url) {
            recentSites = recentSites.filter(r => r.url !== url);
            recentSites.unshift({ url, time: Date.now() });
            if (recentSites.length > 15) recentSites.pop();
            saveJSON('browser_recent_v1', recentSites);
        }

        function updateNavButtons() {
            const canBack = historyIndex > 0;
            const canForward = historyIndex < history.length - 1;
            backBtn.disabled = !canBack;
            forwardBtn.disabled = !canForward;
            backBtn.style.opacity = canBack ? '1' : '0.4';
            forwardBtn.style.opacity = canForward ? '1' : '0.4';
            backBtn.style.cursor = canBack ? 'pointer' : 'default';
            forwardBtn.style.cursor = canForward ? 'pointer' : 'default';
        }

        function pushHistory(url) {
            if (skipNextHistoryPush) { skipNextHistoryPush = false; return; }
            if (history[historyIndex] === url) return; // avoid duplicate consecutive entries
            history = history.slice(0, historyIndex + 1);
            history.push(url);
            if (history.length > 50) history.shift();
            historyIndex = history.length - 1;
            updateNavButtons();
        }

        function siteLabel(url) {
            try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return url; }
        }

        function showNewTab() {
            contentDiv.innerHTML = '';
            const page = document.createElement('div');
            page.style.cssText = 'display:flex; flex-direction:column; align-items:center; height:100%; background:#fff; overflow-y:auto; padding:20px 0;';

            const h1 = document.createElement('h1');
            h1.textContent = 'New Tab';
            h1.style.cssText = 'font-size:24px; margin-bottom:20px; color:#333;';
            page.appendChild(h1);

            const searchRow = document.createElement('div');
            searchRow.style.cssText = 'display:flex; gap:5px;';
            const searchInput = document.createElement('input');
            searchInput.type = 'text';
            searchInput.placeholder = 'Search with DuckDuckGo';
            searchInput.style.cssText = 'width:300px; padding:8px 12px; border:1px solid #C0C0C0; border-radius:15px; font-size:14px;';
            const searchBtn = document.createElement('button');
            searchBtn.textContent = 'Search';
            searchBtn.style.cssText = 'padding:8px 16px; background:#0078D7; color:#fff; border:none; border-radius:15px; cursor:pointer;';
            function doSearch() {
                const query = searchInput.value;
                if (query) { urlInput.value = query; navigate(); }
            }
            searchBtn.addEventListener('click', doSearch);
            searchInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(); });
            searchRow.appendChild(searchInput);
            searchRow.appendChild(searchBtn);
            page.appendChild(searchRow);

            const notice = document.createElement('p');
            notice.style.cssText = !PROXY_URL ? 'margin-top:10px; font-size:12px; color:#a00;' : 'margin-top:10px; font-size:13px; color:#666;';
            notice.textContent = !PROXY_URL
                ? 'No proxy configured - pages will open in a new tab instead of inside the browser.'
                : 'Nota: il server proxy potrebbe essere "addormentato" se inattivo da un po\' (max ogni 12 ore si risveglia da solo) - la prima pagina caricata può richiedere fino a 30-60 secondi.';
            page.appendChild(notice);

            function renderSiteList(title, items, opts) {
                if (items.length === 0) return;
                const section = document.createElement('div');
                section.style.cssText = 'width:80%; max-width:500px; margin-top:20px;';
                const h2 = document.createElement('h3');
                h2.textContent = title;
                h2.style.cssText = 'font-size:13px; color:#555; border-bottom:1px solid #eee; padding-bottom:4px;';
                section.appendChild(h2);
                items.forEach(item => {
                    const row = document.createElement('div');
                    row.style.cssText = 'display:flex; align-items:center; justify-content:space-between; padding:5px 4px; cursor:pointer; font-size:13px;';
                    row.addEventListener('mouseenter', () => row.style.background = '#f0f6ff');
                    row.addEventListener('mouseleave', () => row.style.background = 'transparent');
                    const label = document.createElement('span');
                    label.textContent = siteLabel(item.url);
                    label.style.cssText = 'color:#0078D7; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;';
                    row.appendChild(label);
                    row.addEventListener('click', () => { urlInput.value = item.url; navigate(); });
                    if (opts && opts.removable) {
                        const rm = document.createElement('span');
                        rm.textContent = '✕';
                        rm.style.cssText = 'color:#999; padding:0 6px;';
                        rm.addEventListener('click', (e) => { e.stopPropagation(); opts.onRemove(item); showNewTab(); });
                        row.appendChild(rm);
                    }
                    section.appendChild(row);
                });
                page.appendChild(section);
            }

            renderSiteList('★ Bookmarks', bookmarks, {
                removable: true,
                onRemove: (item) => { bookmarks = bookmarks.filter(b => b.url !== item.url); saveJSON('browser_bookmarks_v1', bookmarks); }
            });
            renderSiteList('Recent', recentSites);

            contentDiv.appendChild(page);
        }

        function showBlockedMessage(url, reason) {
            contentDiv.innerHTML = '';
            const box = document.createElement('div');
            box.style.cssText = 'padding:40px; text-align:center; color:#333;';
            box.innerHTML = `<h2>Unable to load this page</h2><p>${reason}</p>`;
            const btn = document.createElement('button');
            btn.textContent = 'Open in new tab instead';
            btn.style.cssText = 'margin-top:10px; padding:8px 16px; background:#0078D7; color:#fff; border:none; border-radius:4px; cursor:pointer;';
            btn.addEventListener('click', () => window.open(url, '_blank'));
            box.appendChild(btn);
            contentDiv.appendChild(box);
            setLoading(false);
        }

        function showWakingMessage(secondsWaited) {
            contentDiv.innerHTML = '';
            const box = document.createElement('div');
            box.style.cssText = 'display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%; background:#fff; color:#333;';
            box.innerHTML = `<div style="font-size:32px; margin-bottom:10px;">⏳</div>
                <p>Waking up the browser server${'.'.repeat(1 + (secondsWaited % 3))}</p>
                <p style="font-size:12px; color:#666;">This can take up to a minute if it's been asleep for a while.</p>`;
            contentDiv.appendChild(box);
        }

        // Render's free tier serves its own generic "waking up" placeholder page
        // for the FIRST request while the proxy is asleep - if we just pointed the
        // iframe straight at it, that placeholder (not the site the user wanted)
        // would show up inside the browser looking like a broken/wrong page. So we
        // ping our own proxy's root endpoint first and wait for OUR app to actually
        // respond, showing our own "waking up" message meanwhile, and only then
        // navigate the iframe to the real target.
        async function wakeProxy(onReady, onFailed) {
            const maxAttempts = 12; // 12 * 5s = up to ~60s
            for (let attempt = 1; attempt <= maxAttempts; attempt++) {
                showWakingMessage(attempt);
                try {
                    const res = await fetch(PROXY_URL.replace(/\/$/, '') + '/', { cache: 'no-store' });
                    if (res.ok) {
                        const text = await res.text();
                        if (text.includes('Browser proxy server is running')) { onReady(); return; }
                    }
                } catch (e) { /* still asleep or unreachable - keep retrying */ }
                await new Promise(r => setTimeout(r, 5000));
            }
            onFailed();
        }

        // Loads a URL. `addToHistory` is false for Back/Forward/Reload, true for
        // everything the user actively navigates to (typed URL, search, bookmark,
        // recent-site click).
        function loadUrl(url, addToHistory) {
            urlInput.value = url;
            updateStarBtn();
            if (addToHistory) { pushHistory(url); addRecent(url); }

            if (pendingCleanup) { pendingCleanup(); pendingCleanup = null; }

            if (!PROXY_URL) {
                window.open(url, '_blank');
                if (window.appLog) window.appLog('INFO_BROWSE', 'Opened in new tab (no proxy configured): ' + url);
                return;
            }

            setLoading(true);
            wakeProxy(
                () => actuallyNavigate(url),
                () => {
                    setLoading(false);
                    showBlockedMessage(url, 'The proxy server did not wake up in time. It may be temporarily unavailable.');
                    if (window.appLog) window.appLog('ERR_BROWSE', 'Proxy did not wake up for: ' + url);
                }
            );
        }

        function navigate() {
            const url = normalizeUrl(urlInput.value);
            if (!url) return;
            loadUrl(url, true);
        }

        function goBack() {
            if (historyIndex <= 0) return;
            historyIndex--;
            skipNextHistoryPush = true;
            updateNavButtons();
            loadUrl(history[historyIndex], false);
        }
        function goForward() {
            if (historyIndex >= history.length - 1) return;
            historyIndex++;
            skipNextHistoryPush = true;
            updateNavButtons();
            loadUrl(history[historyIndex], false);
        }
        function reload() {
            if (historyIndex < 0) return;
            skipNextHistoryPush = true;
            loadUrl(history[historyIndex], false);
        }
        backBtn.addEventListener('click', goBack);
        forwardBtn.addEventListener('click', goForward);
        reloadBtn.addEventListener('click', reload);
        updateNavButtons();

        function actuallyNavigate(url) {
            const proxiedUrl = PROXY_URL.replace(/\/$/, '') + '/proxy/' + encodeURIComponent(url);

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
                setLoading(false);
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
                setLoading(false);
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
                    setLoading(false);
                    window.removeEventListener('message', onProxyMessage);
                }, 150);
            });
            iframe.addEventListener('error', () => {
                if (settled) return;
                settled = true;
                clearTimeout(loadTimeout);
                setLoading(false);
                window.removeEventListener('message', onProxyMessage);
                showBlockedMessage(url, 'The proxy could not reach this site.');
                if (window.appLog) window.appLog('ERR_BROWSE', 'Proxy failed to load: ' + url);
            });

            contentDiv.innerHTML = '';
            contentDiv.appendChild(iframe);
            if (window.appLog) window.appLog('INFO_BROWSE', 'Navigating (via proxy) to: ' + url);
        }

        // Persistent listener (independent of any single navigation) that keeps
        // the address bar and history in sync when the user follows a link
        // *inside* the proxied page rather than through our own toolbar. The
        // proxy injects a small script into every HTML page that reports the
        // real URL it resolved to.
        window.addEventListener('message', (e) => {
            if (!e.data || e.data.type !== 'proxy-navigated' || !e.data.url) return;
            urlInput.value = e.data.url;
            updateStarBtn();
            pushHistory(e.data.url);
            addRecent(e.data.url);
        });

        goBtn.addEventListener('click', navigate);
        urlInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') navigate();
        });
        urlInput.addEventListener('input', updateStarBtn);

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
