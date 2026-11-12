// Media Player app - plays local mp3/mp4 files chosen by the user via a file
// picker, plus direct links to audio/video files and YouTube links (YouTube plays
// in YouTube's own embedded player, loaded only when a YouTube link is added).
// Local files: Everything happens client-side with Object URLs: no file content
// is ever uploaded anywhere. The playlist itself lives only in memory for
// this window's lifetime (File objects can't survive a page reload, so
// there's nothing useful to persist to localStorage - re-adding files each
// session is the honest tradeoff here).
window.initMediaplayer = function(container, winId) {
    const wrapper = document.createElement('div');
    wrapper.className = 'mediaplayer-content';
    wrapper.style.cssText = 'display:flex; flex-direction:column; height:100%; font-family:Tahoma, sans-serif; font-size:12px; background:#c0c0c0;';

    wrapper.innerHTML = `
        <style>
            .mp-video:fullscreen, .mp-video:-webkit-full-screen { max-width:100%; max-height:100%; width:100%; height:100%; }
            .mp-video-wrap:fullscreen, .mp-video-wrap:-webkit-full-screen { max-height:none; }
        </style>
        <div style="padding:6px; border-bottom:1px solid #808080; display:flex; gap:6px; align-items:center;">
            <button class="mp-add-btn">+ Aggiungi file...</button>
            <input type="file" class="mp-file-input" accept="audio/*,video/*,.mp3,.mp4,.ogg,.oga,.ogv,.wav,.m4a,.aac,.flac,.webm,.mov,.mkv,.m4v,.avi,.wmv,.flv,.3gp,.3g2,.mpg,.mpeg,.ts,.m2ts,.asf" multiple style="display:none;">
            <span class="mp-now-playing" style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; opacity:0.8;">Nessun file caricato</span>
        </div>
        <div style="padding:6px; border-bottom:1px solid #808080; display:flex; gap:6px; align-items:center;">
            <input type="text" class="mp-url" placeholder="Incolla un link (YouTube o file video/audio)" style="flex:1; min-width:0;" autocomplete="off" autocapitalize="off" spellcheck="false">
            <button class="mp-url-btn">▶ Apri link</button>
        </div>
        <div class="mp-video-wrap" style="background:#000; display:none; align-items:center; justify-content:center; flex-shrink:0; position:relative;">
            <div class="mp-yt-box" style="display:none; width:100%; height:220px;"><div class="mp-yt-target"></div></div>
            <video class="mp-video" style="max-width:100%; max-height:220px;"></video>
            <button class="mp-fullscreen" title="Schermo intero" style="position:absolute; right:6px; bottom:6px; opacity:0.85;">⛶</button>
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

    const urlInput = wrapper.querySelector('.mp-url');
    const urlBtn = wrapper.querySelector('.mp-url-btn');
    const ytBox = wrapper.querySelector('.mp-yt-box');
    const addBtn = wrapper.querySelector('.mp-add-btn');
    const fileInput = wrapper.querySelector('.mp-file-input');
    const nowPlaying = wrapper.querySelector('.mp-now-playing');
    const videoWrap = wrapper.querySelector('.mp-video-wrap');
    const videoEl = wrapper.querySelector('.mp-video');
    const fullscreenBtn = wrapper.querySelector('.mp-fullscreen');
    const audioEl = wrapper.querySelector('.mp-audio');
    const seekEl = wrapper.querySelector('.mp-seek');
    const timeCurrentEl = wrapper.querySelector('.mp-time-current');
    const timeTotalEl = wrapper.querySelector('.mp-time-total');
    const prevBtn = wrapper.querySelector('.mp-prev');
    const playPauseBtn = wrapper.querySelector('.mp-playpause');
    const nextBtn = wrapper.querySelector('.mp-next');
    const volumeEl = wrapper.querySelector('.mp-volume');
    const playlistEl = wrapper.querySelector('.mp-playlist');

    let tracks = [];       // [{name, url, isVideo, file, yt}]  (yt = YouTube video id, file = local File)
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

    // ---- Link parsing ----
    function parseYouTubeId(u) {
        try {
            const x = new URL(u);
            const h = x.hostname.replace(/^www\.|^m\.|^music\./, '');
            let id = null;
            if (h === 'youtu.be') id = x.pathname.slice(1).split('/')[0];
            else if (h === 'youtube.com' || h === 'youtube-nocookie.com') {
                if (x.pathname === '/watch') id = x.searchParams.get('v');
                else {
                    const m = x.pathname.match(/^\/(?:shorts|embed|live|v)\/([^/?#]+)/);
                    if (m) id = m[1];
                }
            }
            return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
        } catch (e) { return null; }
    }

    // ---- YouTube embedded player (loaded lazily, only when a YouTube link is used) ----
    let ytPlayer = null, ytReady = false, ytLoadFailed = false;
    function loadYouTubeApi(cb) {
        if (window.YT && window.YT.Player) return cb();
        (window.__mpYtCbs = window.__mpYtCbs || []).push(cb);
        if (window.__mpYtLoading) return;
        window.__mpYtLoading = true;
        const prev = window.onYouTubeIframeAPIReady;
        window.onYouTubeIframeAPIReady = function() {
            if (typeof prev === 'function') prev();
            (window.__mpYtCbs || []).splice(0).forEach(fn => fn());
        };
        const sc = document.createElement('script');
        sc.src = 'https://www.youtube.com/iframe_api';
        sc.onerror = () => { window.__mpYtLoading = false; ytLoadFailed = true; nowPlaying.textContent = 'Impossibile caricare il lettore di YouTube'; };
        document.head.appendChild(sc);
    }
    // Same small interface as an <audio>/<video> element, so the controls work for both
    const yt = {
        get paused() { if (!ytPlayer || !ytReady) return true; const st = ytPlayer.getPlayerState(); return st !== 1 && st !== 3; },
        play() { if (ytPlayer && ytReady) ytPlayer.playVideo(); return Promise.resolve(); },
        pause() { if (ytPlayer && ytReady) ytPlayer.pauseVideo(); },
        get currentTime() { return (ytPlayer && ytReady) ? ytPlayer.getCurrentTime() : 0; },
        set currentTime(v) { if (ytPlayer && ytReady) ytPlayer.seekTo(v, true); },
        get duration() { return (ytPlayer && ytReady) ? ytPlayer.getDuration() : 0; },
        set volume(v) { if (ytPlayer && ytReady) ytPlayer.setVolume(Math.round(v * 100)); }
    };
    function playYouTube(t) {
        const start = () => {
            if (ytPlayer && ytReady) { ytPlayer.loadVideoById(t.yt); ytPlayer.setVolume(Math.round(parseFloat(volumeEl.value) * 100)); return; }
            if (ytPlayer) return; // still initialising: onReady will load the current track
            ytPlayer = new YT.Player(wrapper.querySelector('.mp-yt-target'), {
                width: '100%', height: '100%', videoId: t.yt,
                playerVars: { autoplay: 1, playsinline: 1, rel: 0, origin: location.origin },
                events: {
                    onReady: () => {
                        ytReady = true;
                        const cur = tracks[currentIndex];
                        if (cur && cur.yt && cur.yt !== t.yt) ytPlayer.loadVideoById(cur.yt);
                        ytPlayer.setVolume(Math.round(parseFloat(volumeEl.value) * 100));
                    },
                    onStateChange: (e) => {
                        const cur = tracks[currentIndex];
                        if (!cur || !cur.yt) return;
                        if (e.data === 0) playNext();
                        else if (e.data === 1) {
                            playPauseBtn.textContent = '⏸';
                            try {
                                const title = ytPlayer.getVideoData().title;
                                if (title && cur.name !== title) { cur.name = title; nowPlaying.textContent = title; renderPlaylist(); }
                            } catch (err) {}
                        } else if (e.data === 2) playPauseBtn.textContent = '▶';
                    },
                    onError: (e) => {
                        const blocked = (e.data === 101 || e.data === 150);
                        nowPlaying.textContent = blocked ? 'Il proprietario non permette di riprodurre questo video fuori da YouTube'
                            : (e.data === 100 ? 'Video non trovato o privato' : 'Errore di YouTube (' + e.data + ')');
                        playPauseBtn.textContent = '▶';
                    }
                }
            });
        };
        loadYouTubeApi(start);
    }

    function activeEl() {
        const t = (currentIndex >= 0) ? tracks[currentIndex] : null;
        if (t && t.yt) return yt;
        return (t && t.isVideo) ? videoEl : audioEl;
    }

    function renderPlaylist() {
        playlistEl.innerHTML = '';
        tracks.forEach((t, i) => {
            const row = document.createElement('div');
            row.style.cssText = 'display:flex; align-items:center; padding:4px 6px; cursor:pointer; gap:6px;' +
                (i === currentIndex ? ' background:#000080; color:#fff;' : '');
            row.innerHTML = `<span style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${t.yt ? '▶️' : (t.isVideo ? '🎬' : '🎵')} ${t.name.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</span>`;
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
        if (tracks[i].file) URL.revokeObjectURL(tracks[i].url);
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
        if (ytPlayer && ytReady) { try { ytPlayer.pauseVideo(); } catch (e) {} }
        ytBox.style.display = 'none';
        videoEl.style.display = '';
        fullscreenBtn.style.display = '';
        videoWrap.style.display = 'none';
        playPauseBtn.textContent = '▶';
    }

    function playTrack(i) {
        if (i < 0 || i >= tracks.length) return;
        stopBoth();
        currentIndex = i;
        const t = tracks[i];
        nowPlaying.textContent = t.name;
        if (t.yt) {
            videoWrap.style.display = 'flex';
            videoEl.style.display = 'none';
            fullscreenBtn.style.display = 'none'; // YouTube's own player has a fullscreen button
            ytBox.style.display = 'block';
            playPauseBtn.textContent = '⏸';
            renderPlaylist();
            playYouTube(t);
            return;
        }
        const el = activeEl();
        el.src = t.url;
        videoWrap.style.display = t.isVideo ? 'flex' : 'none';
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

    function addLink() {
        let raw = urlInput.value.trim();
        if (!raw) return;
        if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) raw = 'https://' + raw;
        let u;
        try { u = new URL(raw); } catch (e) { nowPlaying.textContent = 'Link non valido'; return; }
        if (u.protocol !== 'https:' && u.protocol !== 'http:') { nowPlaying.textContent = 'Sono accettati solo link http/https'; return; }
        const id = parseYouTubeId(u.href);
        if (id) {
            tracks.push({ name: 'YouTube ' + id, url: u.href, isVideo: true, file: null, yt: id });
        } else {
            // This site is https: an http link would be blocked as mixed content, so try https
            if (u.protocol === 'http:' && location.protocol === 'https:') u.protocol = 'https:';
            let name = decodeURIComponent((u.pathname.split('/').filter(Boolean).pop()) || u.hostname);
            const audio = /\.(mp3|ogg|oga|opus|wav|m4a|aac|flac)$/i.test(u.pathname);
            tracks.push({ name, url: u.href, isVideo: !audio, file: null, yt: null });
        }
        urlInput.value = '';
        renderPlaylist();
        playTrack(tracks.length - 1);
    }
    urlBtn.addEventListener('click', addLink);
    urlInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') addLink(); });

    playPauseBtn.addEventListener('click', togglePlayPause);
    nextBtn.addEventListener('click', playNext);
    prevBtn.addEventListener('click', playPrev);
    fullscreenBtn.addEventListener('click', () => {
        if (document.fullscreenElement) {
            document.exitFullscreen();
        } else if (videoEl.requestFullscreen) {
            videoEl.requestFullscreen();
        } else if (videoEl.webkitEnterFullscreen) {
            videoEl.webkitEnterFullscreen(); // iOS Safari - only the <video> itself supports fullscreen there
        } else if (videoWrap.requestFullscreen) {
            videoWrap.requestFullscreen();
        }
    });
    volumeEl.addEventListener('input', () => { audioEl.volume = videoEl.volume = yt.volume = parseFloat(volumeEl.value); });

    function updateProgress(el) {
        if (el !== activeEl() || seeking) return;
        seekEl.value = el.duration ? (el.currentTime / el.duration) * 100 : 0;
        timeCurrentEl.textContent = formatTime(el.currentTime);
        timeTotalEl.textContent = formatTime(el.duration);
    }
    // YouTube has no 'timeupdate' event: poll its player while it is the active source
    const ytTimer = setInterval(() => { if (ytReady && activeEl() === yt) updateProgress(yt); }, 500);

    [audioEl, videoEl].forEach(el => {
        el.addEventListener('timeupdate', () => updateProgress(el));
        el.addEventListener('ended', () => { if (el === activeEl()) playNext(); });
        el.addEventListener('loadedmetadata', () => { if (el === activeEl()) timeTotalEl.textContent = formatTime(el.duration); });
        el.addEventListener('error', () => {
            if (el !== activeEl() || !tracks[currentIndex]) return;
            nowPlaying.textContent = tracks[currentIndex].name + (tracks[currentIndex].file ? ' — formato non supportato da questo browser' : ' — non riproducibile (formato non supportato o il sito non permette di usare il file qui)');
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
            clearInterval(ytTimer);
            if (ytPlayer && ytPlayer.destroy) { try { ytPlayer.destroy(); } catch (e) {} }
            tracks.forEach(t => { if (t.file) URL.revokeObjectURL(t.url); });
        });
    }
};
