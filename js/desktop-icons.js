// desktop-icons.js - Position icons in columns and handle clicks
(function() {
    var icons = document.querySelectorAll('.desktop-icon[data-app]');
    var startTop = 20;
    var startLeft = 20;
    var gap = 90; // vertical spacing
    var colGap = 100; // horizontal spacing between columns
    var iconsPerCol = 5;
    for (var i = 0; i < icons.length; i++) {
        var col = Math.floor(i / iconsPerCol);
        var row = i % iconsPerCol;
        icons[i].style.top = (startTop + row * gap) + 'px';
        icons[i].style.left = (startLeft + col * colGap) + 'px';
    }

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
