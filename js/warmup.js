// Sveglia i server Render (free, dormono dopo ~15 min) appena l'utente inizia a scrivere.
// Invia solo una richiesta GET vuota (nessun dato personale) allo stesso server che userà dopo.
(function () {
    const last = {};
    const GAP = 4 * 60 * 1000; // al massimo una volta ogni 4 minuti per server
    function origin(u) {
        try {
            const x = new URL(String(u).replace(/^ws/, 'http'));
            return x.origin + '/';
        } catch (e) { return null; }
    }
    window.warmUp = function (/* ...urls */) {
        for (let i = 0; i < arguments.length; i++) {
            const o = origin(arguments[i]);
            if (!o || (last[o] && Date.now() - last[o] < GAP)) continue;
            last[o] = Date.now();
            try { fetch(o, { mode: 'no-cors', cache: 'no-store' }).catch(function () {}); } catch (e) {}
        }
    };
    // Collega warmUp al primo carattere digitato in un campo (una volta sola per campo).
    window.warmOnType = function (input, getUrls) {
        input.addEventListener('input', function () {
            const u = getUrls();
            window.warmUp.apply(null, Array.isArray(u) ? u : [u]);
        });
    };
})();
