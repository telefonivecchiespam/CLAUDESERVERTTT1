// Media Player app - plays local mp3/mp4 files chosen by the user via a file
// picker. Everything happens client-side with Object URLs: no file content
// is ever uploaded anywhere. The playlist itself lives only in memory for
// this window's lifetime (File objects can't survive a page reload, so
// there's nothing useful to persist to localStorage - re-adding files each
// session is the honest tradeoff here).
window.initMediaplayer = function(container, winId) {
    const wrapper = document.createElement('div');
    wrapper.className = 'mediaplayer-content';
    wrapper.style.cssText = 'display:flex; flex-direction:column; height:100%; font-family:Tahoma, sans-serif; font-size:12px; background:#c0c0c0;';

    wrapper.innerHTML = `
        <div style="padding:6px; border-bottom:1px solid #808080; display:flex; gap:6px; align-items:center;">
            <button class="mp-add-btn">+ Aggiungi file...</button>
            <input type="file" class="mp-file-input" accept="audio/*,video/*,.mp3,.mp4,.ogg,.oga,.ogv,.wav,.m4a,.aac,.flac,.webm,.mov,.mkv,.m4v,.avi,.wmv,.flv,.3gp,.3g2,.mpg,.mpeg,.ts,.m2ts,.asf" multiple style="display:none;">
            <span class="mp-now-playing" style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; opacity:0.8;">Nessun file caricato</span>
        </div>
        <div class="mp-video-wrap" style="background:#000; display:none; align-items:center; justify-content:center; flex-shrink:0;">
            <video class="mp-video" style="max-width:100%; max-height:220px;"></video>
        </div>
        <audio class="mp-audio"></audio>
        <div style="padding:6px 8px; border-bottom:1px solid #808080;">
            <input type="range" class="mp-seek" min="0" max="100" value="0" style="width:100%;">
            <div style="display:flex; justify-content:space-between; opacity:0.7;">
                <span class="mp-time-current">0:00</span>
                <span class="mp-time-total">0:00</span>
            </div>
        </div>
        <div style="padding:6px 8px; border-bottom:1px solid #808080; display:flex; gap:6px; align-items:center; justify-content:center;">
            <button class="mp-prev" title="Precedente">⏮</button>
            <button class="mp-playpause" title="Play/Pausa">▶</button>
            <button class="mp-next" title="Successivo">⏭</button>
            <span style="width:12px;"></span>
            <span>🔊</span>
            <input type="range" class="mp-volume" min="0" max="1" step="0.01" value="1" style="width:80px;">
        </div>
        <div class="mp-playlist" style="flex:1; overflow-y:auto; background:#fff; border:1px inset #808080; margin:6px;"></div>
    `;
    container.appendChild(wrapper);

    const addBtn = wrapper.querySelector('.mp-add-btn');
    const fileInput = wrapper.querySelector('.mp-file-input');
    const nowPlaying = wrapper.querySelector('.mp-now-playing');
    const videoWrap = wrapper.querySelector('.mp-video-wrap');
    const videoEl = wrapper.querySelector('.mp-video');
    const audioEl = wrapper.querySelector('.mp-audio');
    const seekEl = wrapper.querySelector('.mp-seek');
    const timeCurrentEl = wrapper.querySelector('.mp-time-current');
    const timeTotalEl = wrapper.querySelector('.mp-time-total');
    const prevBtn = wrapper.querySelector('.mp-prev');
    const playPauseBtn = wrapper.querySelector('.mp-playpause');
    const nextBtn = wrapper.querySelector('.mp-next');
    const volumeEl = wrapper.querySelector('.mp-volume');
    const playlistEl = wrapper.querySelector('.mp-playlist');

    let tracks = [];       // [{name, url, isVideo, file}]
    let currentIndex = -1;
    let seeking = false;

    function isVideoFile(file) {
        return file.type.startsWith('video/') || /\.(mp4|webm|mov|mkv|m4v|avi|ogv|wmv|flv|3gp|3g2|mpg|mpeg|ts|m2ts|asf)$/i.test(file.name);
    }

    function formatTime(sec) {
        if (!isFinite(sec) || sec < 0) sec = 0;
        const m = Math.floor(sec / 60);
        const s = Math.floor(sec % 60).toString().padStart(2, '0');
        return m + ':' + s;
    }

    function activeEl() {
        return (currentIndex >= 0 && tracks[currentIndex] && tracks[currentIndex].isVideo) ? videoEl : audioEl;
    }

    function renderPlaylist() {
        playlistEl.innerHTML = '';
        tracks.forEach((t, i) => {
            const row = document.createElement('div');
            row.style.cssText = 'display:flex; align-items:center; padding:4px 6px; cursor:pointer; gap:6px;' +
                (i === currentIndex ? ' background:#000080; color:#fff;' : '');
            row.innerHTML = `<span style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${t.isVideo ? '🎬' : '🎵'} ${t.name}</span>`;
            const removeBtn = document.createElement('span');
            removeBtn.textContent = '✕';
            removeBtn.style.cssText = 'padding:0 4px; opacity:0.7;';
            removeBtn.addEventListener('click', (e) => { e.stopPropagation(); removeTrack(i); });
            row.appendChild(removeBtn);
            row.addEventListener('click', () => playTrack(i));
            playlistEl.appendChild(row);
        });
    }

    function removeTrack(i) {
        const wasPlaying = i === currentIndex;
        URL.revokeObjectURL(tracks[i].url);
        tracks.splice(i, 1);
        if (i < currentIndex) currentIndex--;
        else if (wasPlaying) { currentIndex = -1; stopBoth(); nowPlaying.textContent = 'Nessun file caricato'; }
        renderPlaylist();
    }

    function stopBoth() {
        audioEl.pause();
        videoEl.pause();
        audioEl.removeAttribute('src');
        videoEl.removeAttribute('src');
        videoWrap.style.display = 'none';
        playPauseBtn.textContent = '▶';
    }

    function playTrack(i) {
        if (i < 0 || i >= tracks.length) return;
        stopBoth();
        currentIndex = i;
        const t = tracks[i];
        const el = activeEl();
        el.src = t.url;
        videoWrap.style.display = t.isVideo ? 'flex' : 'none';
        nowPlaying.textContent = t.name;
        el.volume = parseFloat(volumeEl.value);
        el.play().catch(() => {}); // autoplay can be blocked until a user gesture; button still works
        playPauseBtn.textContent = '⏸';
        renderPlaylist();
    }

    function togglePlayPause() {
        if (currentIndex < 0) { if (tracks.length) playTrack(0); return; }
        const el = activeEl();
        if (el.paused) { el.play(); playPauseBtn.textContent = '⏸'; }
        else { el.pause(); playPauseBtn.textContent = '▶'; }
    }

    function playNext() { if (tracks.length) playTrack((currentIndex + 1) % tracks.length); }
    function playPrev() { if (tracks.length) playTrack((currentIndex - 1 + tracks.length) % tracks.length); }

    addBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
        const files = Array.from(fileInput.files || []);
        files.forEach(file => {
            tracks.push({ name: file.name, url: URL.createObjectURL(file), isVideo: isVideoFile(file), file });
        });
        renderPlaylist();
        if (currentIndex === -1 && tracks.length) playTrack(0);
        fileInput.value = '';
    });

    playPauseBtn.addEventListener('click', togglePlayPause);
    nextBtn.addEventListener('click', playNext);
    prevBtn.addEventListener('click', playPrev);
    volumeEl.addEventListener('input', () => { audioEl.volume = videoEl.volume = parseFloat(volumeEl.value); });

    [audioEl, videoEl].forEach(el => {
        el.addEventListener('timeupdate', () => {
            if (el !== activeEl() || seeking) return;
            seekEl.value = el.duration ? (el.currentTime / el.duration) * 100 : 0;
            timeCurrentEl.textContent = formatTime(el.currentTime);
            timeTotalEl.textContent = formatTime(el.duration);
        });
        el.addEventListener('ended', () => { if (el === activeEl()) playNext(); });
        el.addEventListener('loadedmetadata', () => { if (el === activeEl()) timeTotalEl.textContent = formatTime(el.duration); });
        el.addEventListener('error', () => {
            if (el !== activeEl() || !tracks[currentIndex]) return;
            nowPlaying.textContent = tracks[currentIndex].name + ' — formato non supportato da questo browser';
            playPauseBtn.textContent = '▶';
        });
    });

    seekEl.addEventListener('pointerdown', () => { seeking = true; });
    seekEl.addEventListener('input', () => {
        const el = activeEl();
        if (el.duration) timeCurrentEl.textContent = formatTime((seekEl.value / 100) * el.duration);
    });
    seekEl.addEventListener('change', () => {
        const el = activeEl();
        if (el.duration) el.currentTime = (seekEl.value / 100) * el.duration;
        seeking = false;
    });
    // Safety net: on some browsers/touch combos 'change' can fail to fire
    // after a drag (e.g. pointer released outside the element), which would
    // otherwise leave 'seeking' stuck true forever and freeze the progress
    // bar. pointerup always fires, so unstick it here regardless.
    seekEl.addEventListener('pointerup', () => {
        const el = activeEl();
        if (el.duration) el.currentTime = (seekEl.value / 100) * el.duration;
        seeking = false;
    });

    // Free the Object URLs when the window closes - otherwise the blob data
    // stays pinned in memory for the rest of the page's life.
    if (window.WindowManager && typeof WindowManager.registerCleanup === 'function') {
        WindowManager.registerCleanup(winId, () => {
            stopBoth();
            tracks.forEach(t => URL.revokeObjectURL(t.url));
        });
    }
};
