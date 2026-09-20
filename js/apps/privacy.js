// Privacy app - solo informativa, nessuna configurazione. Accessibile solo
// dal menu Start (nessuna icona sul desktop). Il contenuto riflette quello
// che il codice fa davvero, quindi se cambia lo storage/i dati usati da
// un'altra app, va aggiornato anche qui.
window.initPrivacy = function(container) {
    container.innerHTML = `
        <div style="padding:14px; font-family:Tahoma, sans-serif; font-size:12px; line-height:1.5; overflow-y:auto; height:100%; box-sizing:border-box;">
            <h2 style="font-size:14px; margin:0 0 10px;">Informativa privacy e cookie</h2>
            <p>Questo sito è statico (GitHub Pages) e non ha un proprio sistema di analisi o pubblicità.
            Non vengono impostati cookie di tracciamento da questa pagina. Quello che segue è l'elenco
            completo di cosa viene salvato e dove, app per app.</p>

            <h3 style="font-size:13px; margin:14px 0 4px;">💾 Dati salvati solo nel tuo browser (localStorage)</h3>
            <ul style="margin:0 0 8px 18px; padding:0;">
                <li><code>notepad_data</code> — il testo del Blocco Note.</li>
                <li><code>browser_bookmarks_v1</code> — i preferiti salvati nel Browser.</li>
                <li><code>browser_recent_v1</code> — la cronologia recente del Browser.</li>
                <li><code>settings_wallpaper</code>, <code>settings_wallpaper_opacity</code>, <code>settings_log_visible</code> — le tue preferenze dall'app Impostazioni (incluso lo sfondo che carichi, se lo carichi).</li>
            </ul>
            <p>Questi dati restano solo sul tuo dispositivo, non vengono mai inviati a nessun server
            di questo progetto, e si cancellano se svuoti i dati del sito dal tuo browser.</p>

            <h3 style="font-size:13px; margin:14px 0 4px;">💬 Chat</h3>
            <p>Username e password (opzionale) vengono inviati al server chat solo per accedere.
            La password, se impostata, è salvata sul server già trasformata con hash SHA-256, mai in
            chiaro e mai nel tuo browser. Se non imposti una password, chiunque può accedere con quel
            nome utente: usalo consapevolmente. I messaggi restano sul server della chat (ultimi 200
            per canale/DM) finché non vengono sovrascritti da messaggi più recenti.</p>

            <h3 style="font-size:13px; margin:14px 0 4px;">🌐 Browser (reverse-proxy)</h3>
            <p>Quando navighi un sito tramite l'app Browser, la richiesta passa dal nostro server proxy,
            non direttamente dal tuo dispositivo. Se il sito visitato imposta dei cookie, questi vengono
            salvati nel tuo browser sotto il dominio del <em>nostro</em> proxy, non sotto quello del sito
            originale. Il proxy blocca in automatico le richieste dirette a domini di tracciamento noti
            (Google Analytics, Google Tag Manager, Facebook Pixel/SDK, Microsoft Clarity, telemetria di
            Bing) — non vengono nemmeno inoltrate. Per servizi con login personale (es. account Google)
            usa sempre il pulsante "apri in nuova scheda": il proxy non è pensato per far transitare
            credenziali o sessioni reali.</p>

            <h3 style="font-size:13px; margin:14px 0 4px;">🖥️ Chi ospita cosa (trattamento dati per servizio)</h3>
            <p>Il sito in sé (questa pagina, HTML/CSS/JS) è ospitato su <strong>GitHub Pages</strong> (GitHub/Microsoft).
            I server dietro le app che scambiano dati in tempo reale sono ospitati separatamente:</p>
            <ul style="margin:0 0 8px 18px; padding:0;">
                <li><strong>Render</strong> (render.com) — ospita i 3 server Node.js: quello di Tris/Scacchi,
                quello della Chat e il reverse-proxy del Browser. Il traffico di queste app (mosse di gioco,
                messaggi chat, pagine web richieste dal Browser) passa dai server di Render prima di
                raggiungere l'altro giocatore/utente o il sito esterno.</li>
                <li><strong>Railway</strong> (railway.com) — ospita la nostra istanza <strong>SearXNG</strong>
                (<code>searxng-production-525c.up.railway.app</code>), il motore di ricerca usato dall'app
                Browser. Le query di ricerca passano da lì prima di essere inoltrate ai motori aggregati
                (Bing, Yahoo, ecc.).</li>
            </ul>
            <p>Render e Railway sono infrastrutture di hosting: vedono il traffico che attraversa i loro
            server (come qualunque hosting), ma non è dato che raccogliamo o analizziamo noi. Nessuno dei
            due servizi viene usato qui per pubblicità o profilazione.</p>

            <h3 style="font-size:13px; margin:14px 0 4px;">🎵 Media Player</h3>
            <p>I file audio/video che apri restano solo nel tuo browser (Object URL locale): non vengono
            mai caricati su nessun server, nemmeno i nostri. La playlist non viene salvata: va ricreata
            ad ogni apertura dell'app.</p>

            <h3 style="font-size:13px; margin:14px 0 4px;">🎮 Tris, Scacchi</h3>
            <p>Solo il nome scelto per la partita viene inviato al server di gioco, e solo per la durata
            della partita stessa (stanza in memoria, non salvata su disco).</p>

            <h3 style="font-size:13px; margin:14px 0 4px;">🔎 Ricerca nel Browser</h3>
            <p>Le ricerche effettuate dall'app Browser passano attraverso una nostra istanza SearXNG
            (motore di ricerca aggregatore), non direttamente a Google/Bing — questo evita che le tue
            ricerche vengano associate al tuo indirizzo IP dai motori di ricerca tradizionali.</p>

            <p style="margin-top:16px; opacity:0.75;">Questa è un'informativa amatoriale per un progetto
            personale, non un documento legale. Se hai dubbi su un dato specifico, chiedi a chi gestisce
            il sito.</p>
        </div>
    `;
};
