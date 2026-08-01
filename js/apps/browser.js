// Browser App - initBrowser(container)
(function() {
    'use strict';

    window.initBrowser = function(container) {
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

        toolbar.appendChild(urlInput);
        toolbar.appendChild(goBtn);
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
                    <p style="margin-top:10px; font-size:12px; color:#666;">Note: Search opens in a new tab due to iframe restrictions.</p>
                </div>
            `;
            const searchInput = contentDiv.querySelector('#search-input');
            const searchBtn = contentDiv.querySelector('#search-btn');
            function doSearch() {
                const query = searchInput.value;
                if (query) {
                    const url = 'https://duckduckgo.com/?q=' + encodeURIComponent(query);
                    window.open(url, '_blank');
                    if (window.appLog) window.appLog('INFO_BROWSE', 'Search opened in new tab: ' + query);
                }
            }
            searchBtn.addEventListener('click', doSearch);
            searchInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') doSearch();
            });
        }

        function navigate() {
            let url = urlInput.value;
            if (!url) return;

            // Add protocol if missing
            if (!url.startsWith('http://') && !url.startsWith('https://')) {
                if (url.includes('.') && !url.includes(' ')) {
                    url = 'https://' + url;
                } else {
                    // Treat as search query
                    url = 'https://duckduckgo.com/?q=' + encodeURIComponent(url);
                }
            }

            urlInput.value = url;

            // Determine if URL is external (different origin). If so, open in new tab.
            const isExternal = (function(u){
                try { const link = new URL(u); return link.origin !== location.origin; }
                catch(e){ return true; }
            })(url);
            if (isExternal) {
                window.open(url, '_blank');
                if (window.appLog) window.appLog('INFO_BROWSE', 'Opened external URL in new tab: ' + url);
                return;
            }
            const iframe = document.createElement('iframe');
            iframe.src = url;
            iframe.style.width = '100%';
            iframe.style.height = '100%';
            iframe.style.border = 'none';

            // Handle iframe load errors
            iframe.addEventListener('load', () => {
                try {
                    const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
                    if (!iframeDoc || iframeDoc.body.innerHTML === '') {
                        throw new Error('Blocked');
                    }
                } catch(e) {
                    contentDiv.innerHTML = `
                        <div style="padding:40px; text-align:center; color:#333;">
                            <h2>Unable to load this page</h2>
                            <p>This site prevents loading in a frame.</p>
                            <button onclick="window.open('${url}', '_blank')" style="margin-top:10px; padding:8px 16px; background:#0078D7; color:#fff; border:none; border-radius:4px; cursor:pointer;">
                                Open in new tab
                            </button>
                        </div>
                    `;
                    if (window.appLog) window.appLog('ERR_BROWSE', 'Site blocked iframe: ' + url);
                }
            });

            contentDiv.innerHTML = '';
            contentDiv.appendChild(iframe);
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
    };
})();
