// A reusable Windows-95/98-style error dialog, used instead of the browser's
// native alert() so error messages match the rest of the desktop's look
// instead of popping a jarring native browser dialog out of theme.
//
// Usage: window.showErrorDialog('Title', 'Message text', 'error' | 'warning')
window.showErrorDialog = function(title, message, kind) {
    kind = kind || 'error';
    const icon = kind === 'warning' ? '⚠️' : '❌';

    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed; inset:0; z-index:99999; background:rgba(0,0,0,0.25); display:flex; align-items:center; justify-content:center;';

    const box = document.createElement('div');
    box.style.cssText = 'width:320px; max-width:90vw; background:#c0c0c0; border:2px solid; border-color:#fff #404040 #404040 #fff; box-shadow:2px 2px 6px rgba(0,0,0,0.5); font-family:Tahoma, "Segoe UI", sans-serif; font-size:12px;';

    box.innerHTML = `
        <div style="background:linear-gradient(to right, #000080, #1084d0); color:#fff; font-weight:bold; padding:4px 6px; display:flex; justify-content:space-between; align-items:center;">
            <span>${title || 'Errore'}</span>
            <span class="err-dlg-close" style="cursor:pointer; background:#c0c0c0; color:#000; width:16px; height:14px; text-align:center; line-height:14px; border:1px solid; border-color:#fff #404040 #404040 #fff;">×</span>
        </div>
        <div style="display:flex; gap:12px; padding:16px; align-items:flex-start;">
            <div style="font-size:28px; line-height:1;">${icon}</div>
            <div class="err-dlg-message" style="flex:1; word-break:break-word;"></div>
        </div>
        <div style="display:flex; justify-content:center; padding-bottom:14px;">
            <button class="err-dlg-ok" style="min-width:75px; padding:4px 12px; font-family:inherit; font-size:12px; background:#c0c0c0; border:2px solid; border-color:#fff #404040 #404040 #fff;">OK</button>
        </div>
    `;
    // Message text set via textContent (not innerHTML) so error text coming
    // from things like ws error messages or filenames can never be
    // interpreted as HTML.
    box.querySelector('.err-dlg-message').textContent = message || '';

    overlay.appendChild(box);
    document.body.appendChild(overlay);

    function close() { overlay.remove(); }
    box.querySelector('.err-dlg-ok').addEventListener('click', close);
    box.querySelector('.err-dlg-close').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    const okBtn = box.querySelector('.err-dlg-ok');
    okBtn.focus();
    document.addEventListener('keydown', function onKey(e) {
        if (e.key === 'Enter' || e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); }
    });
};
