// Settings app - lets the user hide the always-on-top App Log corner widget
// (which can cover other apps' buttons), upload a custom desktop background,
// and tweak its opacity. Everything is stored in localStorage only (never
// sent to any server) so it persists across visits on this device.
//
// The block right below runs as soon as this script loads (not just when the
// Settings window is opened) so saved preferences apply immediately on every
// page load, before the user ever opens the Settings app.
(function applyStoredSettingsOnLoad() {
    function apply() {
        var logVisible = localStorage.getItem('settings_log_visible');
        var logEl = document.getElementById('app-log');
        if (logEl && logVisible === '0') logEl.style.display = 'none';

        var wallpaperData = localStorage.getItem('settings_wallpaper');
        var wallpaperEl = document.querySelector('.wallpaper');
        if (wallpaperEl && wallpaperData) wallpaperEl.style.backgroundImage = "url('" + wallpaperData + "')";

        var opacity = localStorage.getItem('settings_wallpaper_opacity');
        if (wallpaperEl && opacity !== null) wallpaperEl.style.opacity = opacity;
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', apply);
    } else {
        apply();
    }
})();

window.initSettings = function(container, winId) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'padding:14px; font-family:Tahoma, sans-serif; font-size:12px; line-height:1.6; height:100%; overflow-y:auto; box-sizing:border-box;';

    wrap.innerHTML = `
        <h2 style="font-size:14px; margin:0 0 12px;">⚙️ Impostazioni</h2>

        <fieldset style="border:1px solid #999; border-radius:4px; padding:10px; margin-bottom:12px;">
            <legend style="padding:0 4px;">App Log</legend>
            <label style="display:flex; align-items:center; gap:6px; cursor:pointer;">
                <input type="checkbox" class="set-log-visible"> Mostra il riquadro App Log in basso a destra
            </label>
            <div style="opacity:0.7; margin-top:4px; font-size:11px;">Se copre i pulsanti di altre app (es. Pinball su schermi piccoli), disattivalo qui.</div>
        </fieldset>

        <fieldset style="border:1px solid #999; border-radius:4px; padding:10px; margin-bottom:12px;">
            <legend style="padding:0 4px;">Sfondo desktop</legend>
            <button class="set-wallpaper-btn">Carica immagine...</button>
            <input type="file" class="set-wallpaper-input" accept="image/*" style="display:none;">
            <button class="set-wallpaper-reset">Ripristina sfondo predefinito</button>
            <div class="set-wallpaper-status" style="margin-top:6px; opacity:0.7; font-size:11px;"></div>
            <div style="margin-top:8px;">
                Opacità: <input type="range" class="set-wallpaper-opacity" min="0" max="1" step="0.05" style="vertical-align:middle;">
            </div>
        </fieldset>

        <div style="opacity:0.6; font-size:11px;">Tutte queste preferenze restano solo su questo dispositivo (localStorage) — nessuna viene inviata a un server.</div>
    `;
    container.appendChild(wrap);

    const logCheckbox = wrap.querySelector('.set-log-visible');
    const wallpaperBtn = wrap.querySelector('.set-wallpaper-btn');
    const wallpaperInput = wrap.querySelector('.set-wallpaper-input');
    const wallpaperReset = wrap.querySelector('.set-wallpaper-reset');
    const wallpaperStatus = wrap.querySelector('.set-wallpaper-status');
    const opacitySlider = wrap.querySelector('.set-wallpaper-opacity');
    const wallpaperEl = document.querySelector('.wallpaper');

    // -- initial state --
    logCheckbox.checked = localStorage.getItem('settings_log_visible') !== '0';
    opacitySlider.value = localStorage.getItem('settings_wallpaper_opacity') || '0.7';
    if (localStorage.getItem('settings_wallpaper')) {
        wallpaperStatus.textContent = 'Sfondo personalizzato attivo.';
    }

    logCheckbox.addEventListener('change', () => {
        const logEl = document.getElementById('app-log');
        if (logCheckbox.checked) {
            localStorage.setItem('settings_log_visible', '1');
            if (logEl) logEl.style.display = '';
        } else {
            localStorage.setItem('settings_log_visible', '0');
            if (logEl) logEl.style.display = 'none';
        }
    });

    wallpaperBtn.addEventListener('click', () => wallpaperInput.click());
    wallpaperInput.addEventListener('change', () => {
        const file = wallpaperInput.files && wallpaperInput.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            const dataUrl = reader.result;
            try {
                localStorage.setItem('settings_wallpaper', dataUrl);
                if (wallpaperEl) wallpaperEl.style.backgroundImage = "url('" + dataUrl + "')";
                wallpaperStatus.textContent = 'Sfondo aggiornato.';
            } catch (e) {
                // localStorage has a small quota (a few MB) shared with the
                // rest of the site - a large/uncompressed photo can blow past
                // it. Tell the user plainly instead of silently doing nothing.
                wallpaperStatus.textContent = 'Immagine troppo grande per essere salvata - prova un file più piccolo o compresso.';
            }
        };
        reader.readAsDataURL(file);
        wallpaperInput.value = '';
    });

    wallpaperReset.addEventListener('click', () => {
        localStorage.removeItem('settings_wallpaper');
        if (wallpaperEl) wallpaperEl.style.backgroundImage = "url('assets/wallpaper.jpg')";
        wallpaperStatus.textContent = 'Sfondo predefinito ripristinato.';
    });

    opacitySlider.addEventListener('input', () => {
        localStorage.setItem('settings_wallpaper_opacity', opacitySlider.value);
        if (wallpaperEl) wallpaperEl.style.opacity = opacitySlider.value;
    });
};
