// desktop-icons.js - Position icons in columns and handle clicks
(function() {
    var icons = document.querySelectorAll('.desktop-icon[data-app]');
    var startTop = 20;
    var startLeft = 20;
    var colGap = 100; // horizontal spacing between columns
    var taskbarH = 35; // keep icons above the taskbar

    // Lay the icons out in columns that fit the CURRENT window height, so none are
    // hidden when the window is short (resized devtools, phone in landscape).
    function layout() {
        var avail = window.innerHeight - taskbarH;
        var gap = avail < 300 ? 72 : 90; // vertical spacing (tighter on very short screens)
        var iconsPerCol = Math.max(1, Math.floor((avail - startTop) / gap));
        for (var i = 0; i < icons.length; i++) {
            var col = Math.floor(i / iconsPerCol);
            var row = i % iconsPerCol;
            icons[i].style.top = (startTop + row * gap) + 'px';
            icons[i].style.left = (startLeft + col * colGap) + 'px';
        }
    }
    layout();
    window.addEventListener('resize', layout);
    window.addEventListener('orientationchange', function() { setTimeout(layout, 200); });

    // Click handlers
    for (var i = 0; i < icons.length; i++) {
        (function(icon) {
            icon.addEventListener('click', function(e) {
                e.stopPropagation();
                var appId = icon.getAttribute('data-app');
                if (window.launchApp) {
                    window.launchApp(appId);
                }
            });
        })(icons[i]);
    }
})();
