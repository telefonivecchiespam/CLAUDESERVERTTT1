// chat.js - Win98-styled Discord-like chat client for serverchat.js
(function() {
    'use strict';

    // Point this at wherever serverchat.js is running. Override from index.html
    // with: <script>window.CHAT_WS_URL = 'wss://your-host/';</script>
    const DEFAULT_WS_URL = window.CHAT_WS_URL || 'ws://localhost:8081';

    function btnStyle() {
        return 'padding:3px 10px;font-size:12px;font-family:"Segoe UI",sans-serif;border:2px outset #c0c0c0;background:#c0c0c0;cursor:pointer;border-color:#fff #808080 #808080 #fff;';
    }
    function wireBtnPress(btn) {
        btn.onmousedown = () => { btn.style.border = '2px inset #c0c0c0'; };
        btn.onmouseup = () => { btn.style.border = '2px outset #c0c0c0'; };
    }
    function inputStyle() {
        return 'padding:4px 6px;font-size:12px;font-family:"Segoe UI",sans-serif;border:2px inset #c0c0c0;background:#fff;';
    }

    window.initChat = function(container, winId) {
        container.innerHTML = '';
        container.style.cssText = 'height:100%;display:flex;flex-direction:column;font-family:"Segoe UI",sans-serif;font-size:12px;background:#c0c0c0;box-sizing:border-box;overflow:hidden;';

        let ws = null;
        let myUsername = null;
        let servers = {};       // id -> server object {id,name,inviteCode,members,channels:[{id,name,type,messages}]}
        let dms = {};           // withUsername -> {withUsername, messages}
        let onlineUsers = [];
        let activeView = null;  // {type:'dm', withUsername} | {type:'channel', serverId, channelId}
        let selectedServerId = null; // which server is expanded in the rail (null = DM view)

        // Voice chat state - WebRTC mesh, the chat server only relays signaling
        // messages (SDP offers/answers, ICE candidates); audio itself is peer-to-peer.
        let voiceConnection = null; // { serverId, channelId, localStream, peers: Map(username -> {pc, audioEl}), participants: Set }
        const audioContainer = document.createElement('div');
        audioContainer.style.display = 'none';
        container.appendChild(audioContainer);
        const ICE_SERVERS = [
            { urls: 'stun:stun.relay.metered.ca:80' },
            { urls: 'turn:global.relay.metered.ca:80', username: 'b408c53a2abd0ff5deede40e', credential: 'SEDQ1j7CF/5hRqrj' },
            { urls: 'turn:global.relay.metered.ca:80?transport=tcp', username: 'b408c53a2abd0ff5deede40e', credential: 'SEDQ1j7CF/5hRqrj' },
            { urls: 'turn:global.relay.metered.ca:443', username: 'b408c53a2abd0ff5deede40e', credential: 'SEDQ1j7CF/5hRqrj' },
            { urls: 'turns:global.relay.metered.ca:443?transport=tcp', username: 'b408c53a2abd0ff5deede40e', credential: 'SEDQ1j7CF/5hRqrj' }
        ];

        // ===== Login screen =====
        const loginScreen = document.createElement('div');
        loginScreen.style.cssText = 'flex:1;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:8px;';
        loginScreen.innerHTML = '<div style="font-weight:bold;font-size:14px;margin-bottom:6px;">Win98 Chat</div>';

        const userField = document.createElement('input');
        userField.placeholder = 'Username';
        userField.style.cssText = inputStyle() + 'width:180px;';
        const passField = document.createElement('input');
        passField.placeholder = 'Password (optional)';
        passField.type = 'password';
        passField.style.cssText = inputStyle() + 'width:180px;';
        const connectBtn = document.createElement('button');
        connectBtn.textContent = 'Connect';
        connectBtn.style.cssText = btnStyle();
        wireBtnPress(connectBtn);
        const loginStatus = document.createElement('div');
        loginStatus.style.cssText = 'font-size:11px;color:#333;min-height:14px;';

        [userField, passField, connectBtn, loginStatus].forEach(el => loginScreen.appendChild(el));

        const sleepNotice = document.createElement('div');
        sleepNotice.textContent = 'Nota: il server potrebbe essere "addormentato" se inattivo da un po\' (max ogni 30 minuti si risveglia da solo) - la prima connessione può richiedere fino a 30-60 secondi.';
        sleepNotice.style.cssText = 'font-size:10px;color:#666;text-align:center;max-width:220px;margin-top:8px;';
        loginScreen.appendChild(sleepNotice);
        container.appendChild(loginScreen);

        userField.addEventListener('keydown', (e) => { if (e.key === 'Enter') connectBtn.click(); });
        passField.addEventListener('keydown', (e) => { if (e.key === 'Enter') connectBtn.click(); });

        connectBtn.addEventListener('click', () => {
            const username = userField.value.trim();
            if (!username) { loginStatus.textContent = 'Enter a username.'; return; }
            const url = DEFAULT_WS_URL;
            loginStatus.textContent = 'Connecting...';
            connect(url, username, passField.value);
        });

        function connect(url, username, password) {
            try {
                ws = new WebSocket(url);
            } catch (e) {
                loginStatus.textContent = 'Invalid server address.';
                return;
            }
            ws.onopen = () => {
                ws.send(JSON.stringify({ type: 'auth', username, password }));
            };
            ws.onerror = () => {
                loginStatus.textContent = 'Could not connect to chat server.';
            };
            ws.onclose = () => {
                if (myUsername) {
                    loginStatus.textContent = 'Disconnected from chat server.';
                    showLogin();
                } else {
                    loginStatus.textContent = 'Could not connect to chat server.';
                }
            };
            ws.onmessage = (e) => {
                let msg;
                try { msg = JSON.parse(e.data); } catch (err) { return; }
                handleServerMessage(msg);
            };
        }

        function showLogin() {
            myUsername = null;
            appShell.style.display = 'none';
            loginScreen.style.display = 'flex';
        }

        // ===== Main app shell (built once, hidden until authenticated) =====
        const appShell = document.createElement('div');
        appShell.style.cssText = 'display:none;flex:1;min-height:0;';

        // Rail: DM icon + server icons + add button
        const rail = document.createElement('div');
        rail.style.cssText = 'width:52px;background:#a0a0a0;border-right:2px solid #808080;display:flex;flex-direction:column;align-items:center;padding:6px 0;gap:6px;overflow-y:auto;flex-shrink:0;';

        // Column: channel list or DM list
        const listCol = document.createElement('div');
        listCol.style.cssText = 'width:150px;background:#d4d0c8;border-right:2px solid #808080;display:flex;flex-direction:column;flex-shrink:0;';

        // Main panel: header + messages + input
        const mainCol = document.createElement('div');
        mainCol.style.cssText = 'flex:1;display:flex;flex-direction:column;min-width:0;background:#fff;';

        appShell.appendChild(rail);
        appShell.appendChild(listCol);
        appShell.appendChild(mainCol);
        container.appendChild(appShell);

        // ---- Modal helper (used for create/join server, new DM, new channel) ----
        function showModal(title, fields, onSubmit) {
            const overlay = document.createElement('div');
            overlay.style.cssText = 'position:absolute;inset:0;background:rgba(0,0,0,0.35);display:flex;align-items:center;justify-content:center;z-index:50;';
            const box = document.createElement('div');
            box.style.cssText = 'background:#d4d0c8;border:2px outset #d4d0c8;padding:10px;min-width:200px;box-shadow:3px 3px 8px rgba(0,0,0,0.4);';
            const titleEl = document.createElement('div');
            titleEl.textContent = title;
            titleEl.style.cssText = 'font-weight:bold;margin-bottom:8px;';
            box.appendChild(titleEl);

            const inputs = fields.map(f => {
                const inp = document.createElement('input');
                inp.placeholder = f;
                inp.style.cssText = inputStyle() + 'width:100%;box-sizing:border-box;margin-bottom:6px;';
                box.appendChild(inp);
                return inp;
            });

            const btnRow = document.createElement('div');
            btnRow.style.cssText = 'display:flex;justify-content:flex-end;gap:6px;margin-top:4px;';
            const cancelBtn = document.createElement('button');
            cancelBtn.textContent = 'Cancel';
            cancelBtn.style.cssText = btnStyle();
            wireBtnPress(cancelBtn);
            const okBtn = document.createElement('button');
            okBtn.textContent = 'OK';
            okBtn.style.cssText = btnStyle();
            wireBtnPress(okBtn);
            btnRow.appendChild(cancelBtn);
            btnRow.appendChild(okBtn);
            box.appendChild(btnRow);

            overlay.appendChild(box);
            container.style.position = 'relative';
            container.appendChild(overlay);
            if (inputs[0]) inputs[0].focus();

            function close() { overlay.remove(); }
            cancelBtn.addEventListener('click', close);
            okBtn.addEventListener('click', () => {
                onSubmit(inputs.map(i => i.value.trim()));
                close();
            });
            inputs.forEach(inp => inp.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') { onSubmit(inputs.map(i => i.value.trim())); close(); }
            }));
        }

        // ---- Rail rendering ----
        function renderRail() {
            rail.innerHTML = '';

            const dmIcon = document.createElement('div');
            dmIcon.textContent = '💬';
            dmIcon.title = 'Direct Messages';
            dmIcon.style.cssText = 'width:36px;height:36px;display:flex;align-items:center;justify-content:center;font-size:18px;cursor:pointer;border:2px ' + (selectedServerId === null ? 'inset' : 'outset') + ' #c0c0c0;background:#c0c0c0;';
            dmIcon.addEventListener('click', () => { selectedServerId = null; activeView = null; renderRail(); renderList(); renderMain(); });
            rail.appendChild(dmIcon);

            const sep = document.createElement('div');
            sep.style.cssText = 'width:70%;border-top:1px solid #808080;margin:2px 0;';
            rail.appendChild(sep);

            Object.values(servers).forEach(server => {
                const icon = document.createElement('div');
                icon.textContent = server.name.slice(0, 2).toUpperCase();
                icon.title = server.name;
                icon.style.cssText = 'width:36px;height:36px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:bold;cursor:pointer;border:2px ' + (selectedServerId === server.id ? 'inset' : 'outset') + ' #c0c0c0;background:#c0c0c0;';
                icon.addEventListener('click', () => {
                    selectedServerId = server.id;
                    const first = server.channels[0];
                    activeView = first ? { type: 'channel', serverId: server.id, channelId: first.id } : null;
                    renderRail(); renderList(); renderMain();
                });
                rail.appendChild(icon);
            });

            const addBtn = document.createElement('div');
            addBtn.textContent = '+';
            addBtn.title = 'Create or join a server';
            addBtn.style.cssText = 'width:36px;height:36px;display:flex;align-items:center;justify-content:center;font-size:18px;cursor:pointer;border:2px outset #c0c0c0;background:#c0c0c0;color:#2a7a2a;font-weight:bold;';
            addBtn.addEventListener('click', () => showAddServerMenu(addBtn));
            rail.appendChild(addBtn);
        }

        function showAddServerMenu(anchorEl) {
            const menu = document.createElement('div');
            menu.style.cssText = 'position:absolute;background:#d4d0c8;border:2px outset #d4d0c8;z-index:60;box-shadow:2px 2px 6px rgba(0,0,0,0.4);';
            const rect = anchorEl.getBoundingClientRect();
            const contRect = container.getBoundingClientRect();
            menu.style.left = (rect.right - contRect.left + 4) + 'px';
            menu.style.top = (rect.top - contRect.top) + 'px';

            const createItem = document.createElement('div');
            createItem.textContent = 'Create Server';
            createItem.style.cssText = 'padding:6px 12px;cursor:pointer;';
            createItem.addEventListener('mouseenter', () => { createItem.style.background = '#000080'; createItem.style.color = '#fff'; });
            createItem.addEventListener('mouseleave', () => { createItem.style.background = ''; createItem.style.color = ''; });
            createItem.addEventListener('click', () => {
                menu.remove();
                showModal('Create Server', ['Server name'], (vals) => {
                    if (!vals[0]) return;
                    ws.send(JSON.stringify({ type: 'create_server', name: vals[0] }));
                });
            });

            const joinItem = document.createElement('div');
            joinItem.textContent = 'Join Server (enter code)';
            joinItem.style.cssText = 'padding:6px 12px;cursor:pointer;border-top:1px solid #808080;';
            joinItem.addEventListener('mouseenter', () => { joinItem.style.background = '#000080'; joinItem.style.color = '#fff'; });
            joinItem.addEventListener('mouseleave', () => { joinItem.style.background = ''; joinItem.style.color = ''; });
            joinItem.addEventListener('click', () => {
                menu.remove();
                showModal('Join Server', ['Invite code'], (vals) => {
                    if (!vals[0]) return;
                    ws.send(JSON.stringify({ type: 'join_server', inviteCode: vals[0].toUpperCase() }));
                });
            });

            menu.appendChild(createItem);
            menu.appendChild(joinItem);
            container.appendChild(menu);

            const closeOnClickAway = (e) => {
                if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('click', closeOnClickAway, true); }
            };
            setTimeout(() => document.addEventListener('click', closeOnClickAway, true), 0);
        }

        function showAddChannelMenu(anchorEl, server) {
            const menu = document.createElement('div');
            menu.style.cssText = 'position:absolute;background:#d4d0c8;border:2px outset #d4d0c8;z-index:60;box-shadow:2px 2px 6px rgba(0,0,0,0.4);';
            const rect = anchorEl.getBoundingClientRect();
            const contRect = container.getBoundingClientRect();
            menu.style.left = (rect.right - contRect.left + 4) + 'px';
            menu.style.top = (rect.top - contRect.top) + 'px';

            function menuItem(label, onClick) {
                const item = document.createElement('div');
                item.textContent = label;
                item.style.cssText = 'padding:6px 12px;cursor:pointer;white-space:nowrap;';
                item.addEventListener('mouseenter', () => { item.style.background = '#000080'; item.style.color = '#fff'; });
                item.addEventListener('mouseleave', () => { item.style.background = ''; item.style.color = ''; });
                item.addEventListener('click', () => { menu.remove(); onClick(); });
                return item;
            }

            menu.appendChild(menuItem('# New Text Channel', () => {
                showModal('New Text Channel', ['Channel name'], (vals) => {
                    if (!vals[0]) return;
                    ws.send(JSON.stringify({ type: 'create_channel', serverId: server.id, name: vals[0], channelType: 'text' }));
                });
            }));
            menu.appendChild(menuItem('🔊 New Voice Channel', () => {
                showModal('New Voice Channel', ['Channel name'], (vals) => {
                    if (!vals[0]) return;
                    ws.send(JSON.stringify({ type: 'create_channel', serverId: server.id, name: vals[0], channelType: 'voice' }));
                });
            }));

            container.appendChild(menu);
            const closeOnClickAway = (e) => {
                if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('click', closeOnClickAway, true); }
            };
            setTimeout(() => document.addEventListener('click', closeOnClickAway, true), 0);
        }


        function renderList() {
            listCol.innerHTML = '';

            const header = document.createElement('div');
            header.style.cssText = 'padding:6px 8px;font-weight:bold;border-bottom:1px solid #808080;display:flex;justify-content:space-between;align-items:center;';

            if (selectedServerId === null) {
                header.innerHTML = '<span>Direct Messages</span>';
                const addBtn = document.createElement('span');
                addBtn.textContent = '+';
                addBtn.style.cssText = 'cursor:pointer;color:#2a7a2a;font-weight:bold;';
                addBtn.addEventListener('click', () => {
                    showModal('New Direct Message', ['Username'], (vals) => {
                        if (!vals[0]) return;
                        if (!dms[vals[0]]) dms[vals[0]] = { withUsername: vals[0], messages: [] };
                        activeView = { type: 'dm', withUsername: vals[0] };
                        renderList(); renderMain();
                    });
                });
                header.appendChild(addBtn);
                listCol.appendChild(header);

                const list = document.createElement('div');
                list.style.cssText = 'flex:1;overflow-y:auto;';
                Object.values(dms).forEach(dm => {
                    const row = document.createElement('div');
                    const isActive = activeView && activeView.type === 'dm' && activeView.withUsername === dm.withUsername;
                    row.style.cssText = 'padding:6px 8px;cursor:pointer;display:flex;align-items:center;gap:5px;' + (isActive ? 'background:#000080;color:#fff;' : '');
                    const dot = document.createElement('span');
                    dot.textContent = onlineUsers.includes(dm.withUsername) ? '🟢' : '⚪';
                    dot.style.fontSize = '8px';
                    const label = document.createElement('span');
                    label.textContent = dm.withUsername;
                    row.appendChild(dot);
                    row.appendChild(label);
                    row.addEventListener('click', () => { activeView = { type: 'dm', withUsername: dm.withUsername }; renderList(); renderMain(); });
                    list.appendChild(row);
                });
                listCol.appendChild(list);
            } else {
                const server = servers[selectedServerId];
                if (!server) return;
                header.innerHTML = '<span>' + escapeHtml(server.name) + '</span>';
                const addBtn = document.createElement('span');
                addBtn.textContent = '+';
                addBtn.style.cssText = 'cursor:pointer;color:#2a7a2a;font-weight:bold;';
                addBtn.addEventListener('click', () => showAddChannelMenu(addBtn, server));
                header.appendChild(addBtn);
                listCol.appendChild(header);

                const inviteRow = document.createElement('div');
                inviteRow.textContent = 'Invite code: ' + server.inviteCode;
                inviteRow.style.cssText = 'padding:4px 8px;font-size:10px;color:#555;border-bottom:1px solid #ccc;';
                listCol.appendChild(inviteRow);

                const list = document.createElement('div');
                list.style.cssText = 'flex:1;overflow-y:auto;';
                server.channels.forEach(ch => {
                    const row = document.createElement('div');
                    const isActive = activeView && activeView.type === 'channel' && activeView.channelId === ch.id;
                    const isVoice = ch.type === 'voice';
                    const inThisVoice = isVoice && voiceConnection && voiceConnection.channelId === ch.id;
                    const occupants = isVoice ? (ch.voiceParticipants || []) : [];
                    row.style.cssText = 'padding:6px 8px;cursor:pointer;' + (isActive ? 'background:#000080;color:#fff;' : '') + (inThisVoice ? 'font-weight:bold;color:#2a7a2a;' : '');
                    const line1 = document.createElement('div');
                    line1.textContent = (isVoice ? '🔊 ' : '# ') + ch.name + (inThisVoice ? ' (connected)' : '');
                    row.appendChild(line1);
                    if (isVoice && occupants.length > 0) {
                        const line2 = document.createElement('div');
                        line2.style.cssText = 'font-size:10px;opacity:0.8;padding-left:16px;';
                        line2.textContent = occupants.map(n => n === myUsername ? n + ' (you)' : n).join(', ');
                        row.appendChild(line2);
                    }
                    row.addEventListener('click', () => { activeView = { type: 'channel', serverId: server.id, channelId: ch.id }; renderList(); renderMain(); });
                    list.appendChild(row);
                });
                listCol.appendChild(list);

                const membersFooter = document.createElement('div');
                membersFooter.style.cssText = 'border-top:1px solid #808080;padding:4px 8px;font-size:10px;color:#555;max-height:80px;overflow-y:auto;';
                membersFooter.textContent = 'Members: ' + server.members.join(', ');
                listCol.appendChild(membersFooter);
            }
        }

        // ---- Voice chat (WebRTC mesh) ----
        function createPeerConnection(peerUsername, serverId, channelId) {
            const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

            if (voiceConnection && voiceConnection.localStream) {
                voiceConnection.localStream.getTracks().forEach(track => pc.addTrack(track, voiceConnection.localStream));
            }

            pc.onicecandidate = (e) => {
                if (e.candidate && ws) {
                    ws.send(JSON.stringify({
                        type: 'voice_signal', serverId, channelId,
                        toUsername: peerUsername,
                        data: { candidate: e.candidate }
                    }));
                }
            };

            pc.ontrack = (e) => {
                let audioEl = audioContainer.querySelector('audio[data-peer="' + peerUsername + '"]');
                if (!audioEl) {
                    audioEl = document.createElement('audio');
                    audioEl.dataset.peer = peerUsername;
                    audioEl.autoplay = true;
                    audioContainer.appendChild(audioEl);
                }
                audioEl.srcObject = e.streams[0];
            };

            pc.onconnectionstatechange = () => {
                if (pc.connectionState === 'connected') {
                    const peer = voiceConnection && voiceConnection.peers.get(peerUsername);
                    if (peer && peer.reconnectTimer) { clearTimeout(peer.reconnectTimer); peer.reconnectTimer = null; }
                    return;
                }
                if (['failed', 'disconnected'].includes(pc.connectionState)) {
                    if (window.appLog) window.appLog('WARN_CHAT', 'Voice connection to ' + peerUsername + ' ' + pc.connectionState);
                    if (!voiceConnection) return;

                    if (pc.connectionState === 'failed') {
                        attemptReconnect(peerUsername, serverId, channelId);
                        return;
                    }
                    // 'disconnected' is often transient (brief network blip) and can
                    // recover on its own within a few seconds - give it a grace period
                    // before tearing down and reconnecting.
                    const peer = voiceConnection.peers.get(peerUsername);
                    if (peer && !peer.reconnectTimer) {
                        peer.reconnectTimer = setTimeout(() => {
                            if (voiceConnection && voiceConnection.peers.get(peerUsername) === peer && pc.connectionState !== 'connected') {
                                attemptReconnect(peerUsername, serverId, channelId);
                            }
                        }, 6000);
                    }
                }
            };

            pc.oniceconnectionstatechange = () => {
                if (window.appLog) window.appLog('INFO_CHAT', 'ICE state with ' + peerUsername + ': ' + pc.iceConnectionState);
            };

            pc.onicegatheringstatechange = () => {
                if (pc.iceGatheringState === 'complete' && window.appLog) {
                    window.appLog('INFO_CHAT', 'Finished gathering ICE candidates for ' + peerUsername);
                }
            };

            if (voiceConnection) {
                voiceConnection.peers.set(peerUsername, { pc, pendingCandidates: [] });
            }
            return pc;
        }

        // Safari/Chrome gather and send ICE candidates at slightly different points
        // in the offer/answer dance. Queue candidates that arrive before we have a
        // remote description yet, instead of dropping them - a race here is enough
        // to make a connection fail on some browser pairings.
        async function addOrQueueCandidate(peer, candidate) {
            if (peer.pc.remoteDescription && peer.pc.remoteDescription.type) {
                try { await peer.pc.addIceCandidate(new RTCIceCandidate(candidate)); }
                catch (err) { /* benign - can happen with candidates that arrive late */ }
            } else {
                peer.pendingCandidates.push(candidate);
            }
        }

        async function flushPendingCandidates(peer) {
            const queued = peer.pendingCandidates;
            peer.pendingCandidates = [];
            for (const candidate of queued) {
                try { await peer.pc.addIceCandidate(new RTCIceCandidate(candidate)); }
                catch (err) { /* benign */ }
            }
        }

        function removePeer(peerUsername) {
            if (!voiceConnection) return;
            const peer = voiceConnection.peers.get(peerUsername);
            if (peer) {
                if (peer.reconnectTimer) clearTimeout(peer.reconnectTimer);
                try { peer.pc.close(); } catch (e) {}
                voiceConnection.peers.delete(peerUsername);
            }
            const audioEl = audioContainer.querySelector('audio[data-peer="' + peerUsername + '"]');
            if (audioEl) audioEl.remove();
        }

        async function sendOfferTo(peerUsername, serverId, channelId) {
            if (window.appLog) window.appLog('INFO_CHAT', 'Creating offer for ' + peerUsername + '...');
            const pc = createPeerConnection(peerUsername, serverId, channelId);
            try {
                const offer = await pc.createOffer();
                await pc.setLocalDescription(offer);
                ws.send(JSON.stringify({
                    type: 'voice_signal', serverId, channelId,
                    toUsername: peerUsername, data: { sdp: pc.localDescription }
                }));
                if (window.appLog) window.appLog('INFO_CHAT', 'Offer sent to ' + peerUsername);
            } catch (err) {
                console.error('Voice offer failed for', peerUsername, err);
                if (window.appLog) window.appLog('ERR_CHAT', 'Offer creation failed for ' + peerUsername + ': ' + err.name + ' - ' + err.message);
            }
        }

        // When a connection drops, only one side should re-offer (otherwise both
        // sides race and create duplicate connections) - the alphabetically-first
        // username takes responsibility for reconnecting.
        function attemptReconnect(peerUsername, serverId, channelId) {
            if (!voiceConnection || !myUsername) return;
            removePeer(peerUsername);
            if (myUsername < peerUsername) {
                if (window.appLog) window.appLog('INFO_CHAT', 'Reconnecting to ' + peerUsername + '...');
                sendOfferTo(peerUsername, serverId, channelId);
            } else {
                if (window.appLog) window.appLog('INFO_CHAT', 'Waiting for ' + peerUsername + ' to reconnect...');
                voiceConnection.participants.add(peerUsername);
            }
            renderMain();
        }

        async function joinVoiceChannel(serverId, channelId) {
            if (voiceConnection) {
                await leaveVoiceChannel();
            }
            if (window.appLog) window.appLog('INFO_CHAT', 'Requesting microphone access...');
            let localStream;
            try {
                localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            } catch (err) {
                alert('Could not access your microphone: ' + err.message);
                if (window.appLog) window.appLog('ERR_CHAT', 'getUserMedia failed: ' + err.name + ' - ' + err.message);
                return;
            }
            if (window.appLog) window.appLog('INFO_CHAT', 'Microphone acquired, tracks: ' + localStream.getAudioTracks().length);
            voiceConnection = { serverId, channelId, localStream, peers: new Map(), participants: new Set(), isMuted: false };
            ws.send(JSON.stringify({ type: 'voice_join', serverId, channelId }));
            renderList(); renderMain();
            if (window.appLog) window.appLog('INFO_CHAT', 'Sent voice_join, waiting for participant list');
        }

        async function leaveVoiceChannel() {
            if (!voiceConnection) return;
            const { serverId, channelId, localStream, peers } = voiceConnection;
            if (ws) ws.send(JSON.stringify({ type: 'voice_leave', serverId, channelId }));
            peers.forEach((peer, username) => removePeer(username));
            if (localStream) localStream.getTracks().forEach(t => t.stop());
            voiceConnection = null;
            renderList(); renderMain();
            if (window.appLog) window.appLog('INFO_CHAT', 'Left voice channel');
        }

        async function handleVoiceParticipants(msg) {
            if (!voiceConnection || voiceConnection.channelId !== msg.channelId) return;
            if (window.appLog) window.appLog('INFO_CHAT', 'Voice participants already there: ' + (msg.participants.length ? msg.participants.join(', ') : '(none)'));
            // We're the new arrival - offer a connection to everyone already there.
            for (const peerUsername of msg.participants) {
                voiceConnection.participants.add(peerUsername);
                await sendOfferTo(peerUsername, msg.serverId, msg.channelId);
            }
            renderMain();
        }

        function handleVoicePeerJoined(msg) {
            if (!voiceConnection || voiceConnection.channelId !== msg.channelId) return;
            voiceConnection.participants.add(msg.username);
            if (window.appLog) window.appLog('INFO_CHAT', msg.username + ' joined the voice channel, waiting for their offer...');
            renderMain(); renderList();
            // We don't initiate here - the peer who just joined will send us an offer.
        }

        function handleVoicePeerLeft(msg) {
            if (!voiceConnection || voiceConnection.channelId !== msg.channelId) return;
            voiceConnection.participants.delete(msg.username);
            removePeer(msg.username);
            renderMain(); renderList();
        }

        async function handleVoiceSignal(msg) {
            if (!voiceConnection || voiceConnection.channelId !== msg.channelId) return;
            const fromUsername = msg.fromUsername;
            const data = msg.data || {};

            if (data.sdp && data.sdp.type === 'offer') {
                if (window.appLog) window.appLog('INFO_CHAT', 'Received offer from ' + fromUsername);
                voiceConnection.participants.add(fromUsername);
                const pc = createPeerConnection(fromUsername, msg.serverId, msg.channelId);
                const peer = voiceConnection.peers.get(fromUsername);
                try {
                    await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
                    await flushPendingCandidates(peer);
                    const answer = await pc.createAnswer();
                    await pc.setLocalDescription(answer);
                    ws.send(JSON.stringify({
                        type: 'voice_signal', serverId: msg.serverId, channelId: msg.channelId,
                        toUsername: fromUsername, data: { sdp: pc.localDescription }
                    }));
                    if (window.appLog) window.appLog('INFO_CHAT', 'Answer sent to ' + fromUsername);
                } catch (err) {
                    console.error('Voice answer failed for', fromUsername, err);
                    if (window.appLog) window.appLog('ERR_CHAT', 'Answer creation failed for ' + fromUsername + ': ' + err.name + ' - ' + err.message);
                }
                renderMain();
            } else if (data.sdp && data.sdp.type === 'answer') {
                if (window.appLog) window.appLog('INFO_CHAT', 'Received answer from ' + fromUsername);
                const peer = voiceConnection.peers.get(fromUsername);
                if (peer) {
                    try {
                        await peer.pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
                        await flushPendingCandidates(peer);
                    } catch (err) {
                        console.error('Voice setRemoteDescription (answer) failed', err);
                        if (window.appLog) window.appLog('ERR_CHAT', 'setRemoteDescription (answer) failed: ' + err.name + ' - ' + err.message);
                    }
                } else if (window.appLog) {
                    window.appLog('WARN_CHAT', 'Got an answer from ' + fromUsername + ' but no matching connection exists');
                }
            } else if (data.candidate) {
                const peer = voiceConnection.peers.get(fromUsername);
                if (peer) await addOrQueueCandidate(peer, data.candidate);
                else if (window.appLog) window.appLog('WARN_CHAT', 'Got an ICE candidate from ' + fromUsername + ' but no matching connection exists');
            }
        }


        function escapeHtml(s) {
            const d = document.createElement('div');
            d.textContent = s;
            return d.innerHTML;
        }
        function formatTime(ts) {
            const d = new Date(ts);
            return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
        }

        function currentMessages() {
            if (!activeView) return [];
            if (activeView.type === 'dm') {
                const dm = dms[activeView.withUsername];
                return dm ? dm.messages : [];
            }
            const server = servers[activeView.serverId];
            if (!server) return [];
            const ch = server.channels.find(c => c.id === activeView.channelId);
            return ch ? ch.messages : [];
        }

        function renderMain() {
            mainCol.innerHTML = '';

            if (!activeView) {
                const placeholder = document.createElement('div');
                placeholder.style.cssText = 'flex:1;display:flex;align-items:center;justify-content:center;color:#888;';
                placeholder.textContent = 'Select a channel or a conversation to start chatting.';
                mainCol.appendChild(placeholder);
                return;
            }

            if (activeView.type === 'channel') {
                const server = servers[activeView.serverId];
                const ch = server && server.channels.find(c => c.id === activeView.channelId);
                if (ch && ch.type === 'voice') {
                    renderVoicePanel(server, ch);
                    return;
                }
            }

            const header = document.createElement('div');
            header.style.cssText = 'padding:6px 10px;font-weight:bold;border-bottom:1px solid #808080;background:#d4d0c8;';
            header.textContent = activeView.type === 'dm' ? '@ ' + activeView.withUsername : '# ' + (servers[activeView.serverId] && servers[activeView.serverId].channels.find(c => c.id === activeView.channelId) || {}).name;
            mainCol.appendChild(header);

            const msgArea = document.createElement('div');
            msgArea.style.cssText = 'flex:1;overflow-y:auto;padding:8px;';
            currentMessages().forEach(m => msgArea.appendChild(renderMessageRow(m)));
            mainCol.appendChild(msgArea);
            msgArea.scrollTop = msgArea.scrollHeight;

            const inputRow = document.createElement('div');
            inputRow.style.cssText = 'display:flex;border-top:1px solid #808080;padding:6px;gap:6px;flex-shrink:0;';
            const msgInput = document.createElement('input');
            msgInput.placeholder = 'Type a message...';
            msgInput.style.cssText = inputStyle() + 'flex:1;';
            const sendBtn = document.createElement('button');
            sendBtn.textContent = 'Send';
            sendBtn.style.cssText = btnStyle();
            wireBtnPress(sendBtn);

            function doSend() {
                const content = msgInput.value.trim();
                if (!content || !activeView) return;
                const target = activeView.type === 'dm'
                    ? { type: 'dm', toUsername: activeView.withUsername }
                    : { type: 'channel', serverId: activeView.serverId, channelId: activeView.channelId };
                ws.send(JSON.stringify({ type: 'send_message', target, content }));
                msgInput.value = '';
            }
            sendBtn.addEventListener('click', doSend);
            msgInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSend(); });

            inputRow.appendChild(msgInput);
            inputRow.appendChild(sendBtn);
            mainCol.appendChild(inputRow);
            msgInput.focus();
        }

        function toggleMute() {
            if (!voiceConnection || !voiceConnection.localStream) return;
            voiceConnection.isMuted = !voiceConnection.isMuted;
            voiceConnection.localStream.getAudioTracks().forEach(track => {
                track.enabled = !voiceConnection.isMuted;
            });
            if (window.appLog) window.appLog('INFO_CHAT', voiceConnection.isMuted ? 'Microphone muted' : 'Microphone unmuted');
            renderMain();
        }

        function renderVoicePanel(server, ch) {
            const header = document.createElement('div');
            header.style.cssText = 'padding:6px 10px;font-weight:bold;border-bottom:1px solid #808080;background:#d4d0c8;';
            header.textContent = '🔊 ' + ch.name;
            mainCol.appendChild(header);

            const body = document.createElement('div');
            body.style.cssText = 'flex:1;display:flex;flex-direction:column;align-items:center;padding:20px;gap:14px;';

            const inThisChannel = voiceConnection && voiceConnection.channelId === ch.id;

            const participants = document.createElement('div');
            participants.style.cssText = 'width:100%;max-width:260px;';
            const list = inThisChannel
                ? [myUsername, ...Array.from(voiceConnection.participants)]
                : (ch.voiceParticipants || []);

            if (list.length === 0) {
                const empty = document.createElement('div');
                empty.style.cssText = 'text-align:center;color:#888;';
                empty.textContent = inThisChannel ? 'Just you so far...' : 'Nobody is in this voice channel right now.';
                participants.appendChild(empty);
            } else {
                list.forEach(name => {
                    const row = document.createElement('div');
                    row.style.cssText = 'display:flex;align-items:center;gap:6px;padding:4px 8px;';
                    const isMe = name === myUsername;
                    const icon = (isMe && inThisChannel && voiceConnection.isMuted) ? '🔇' : '🎙️';
                    row.innerHTML = '<span>' + icon + '</span><span>' + escapeHtml(name) + (isMe ? ' (you)' : '') + '</span>';
                    participants.appendChild(row);
                });
            }
            body.appendChild(participants);

            const btnRow = document.createElement('div');
            btnRow.style.cssText = 'display:flex;gap:8px;';

            if (inThisChannel) {
                const muteBtn = document.createElement('button');
                muteBtn.style.cssText = btnStyle() + 'padding:6px 20px;';
                wireBtnPress(muteBtn);
                muteBtn.textContent = voiceConnection.isMuted ? 'Unmute' : 'Mute';
                muteBtn.addEventListener('click', () => toggleMute());
                btnRow.appendChild(muteBtn);
            }

            const actionBtn = document.createElement('button');
            actionBtn.style.cssText = btnStyle() + 'padding:6px 20px;';
            wireBtnPress(actionBtn);
            if (inThisChannel) {
                actionBtn.textContent = 'Leave Voice';
                actionBtn.addEventListener('click', () => leaveVoiceChannel());
            } else {
                actionBtn.textContent = 'Join Voice';
                actionBtn.addEventListener('click', () => joinVoiceChannel(server.id, ch.id));
            }
            btnRow.appendChild(actionBtn);
            body.appendChild(btnRow);

            if (voiceConnection && voiceConnection.channelId !== ch.id) {
                const note = document.createElement('div');
                note.style.cssText = 'font-size:11px;color:#888;text-align:center;';
                note.textContent = "You're currently in another voice channel - joining this one will leave it.";
                body.appendChild(note);
            }

            mainCol.appendChild(body);
        }

        function renderMessageRow(m) {
            const row = document.createElement('div');
            row.style.cssText = 'margin-bottom:6px;';
            const meta = document.createElement('span');
            meta.innerHTML = '<b>' + escapeHtml(m.from) + '</b> <span style="color:#888;font-size:10px;">' + formatTime(m.time) + '</span>';
            const content = document.createElement('div');
            content.textContent = m.content;
            content.style.cssText = 'white-space:pre-wrap;word-break:break-word;';
            row.appendChild(meta);
            row.appendChild(content);
            return row;
        }

        // ---- Server message handling ----
        function handleServerMessage(msg) {
            switch (msg.type) {
                case 'auth_ok':
                    myUsername = msg.username;
                    servers = {};
                    (msg.servers || []).forEach(s => { servers[s.id] = s; });
                    dms = {};
                    (msg.dms || []).forEach(d => { dms[d.withUsername] = d; });
                    onlineUsers = msg.online || [];
                    loginScreen.style.display = 'none';
                    appShell.style.display = 'flex';
                    renderRail(); renderList(); renderMain();
                    if (window.appLog) window.appLog('INFO_CHAT', 'Connected as ' + myUsername);
                    break;

                case 'auth_error':
                    loginStatus.textContent = msg.message;
                    if (window.appLog) window.appLog('ERR_CHAT', msg.message);
                    break;

                case 'server_created':
                case 'server_joined':
                    servers[msg.server.id] = msg.server;
                    selectedServerId = msg.server.id;
                    activeView = msg.server.channels[0] ? { type: 'channel', serverId: msg.server.id, channelId: msg.server.channels[0].id } : null;
                    renderRail(); renderList(); renderMain();
                    if (window.appLog) window.appLog('INFO_CHAT', 'Joined server ' + msg.server.name);
                    break;

                case 'join_error':
                    alert(msg.message);
                    break;

                case 'channel_created': {
                    const server = servers[msg.serverId];
                    if (server) {
                        server.channels.push(msg.channel);
                        if (selectedServerId === msg.serverId) renderList();
                    }
                    break;
                }

                case 'member_joined':
                    if (window.appLog) window.appLog('INFO_CHAT', msg.username + ' joined a server with you');
                    break;

                case 'voice_occupancy': {
                    const server = servers[msg.serverId];
                    const ch = server && server.channels.find(c => c.id === msg.channelId);
                    if (ch) {
                        ch.voiceParticipants = msg.participants;
                        if (selectedServerId === msg.serverId) renderList();
                        if (activeView && activeView.type === 'channel' && activeView.channelId === msg.channelId) renderMain();
                    }
                    break;
                }

                case 'message': {
                    const t = msg.target;
                    if (t.type === 'dm') {
                        if (!dms[t.withUsername]) dms[t.withUsername] = { withUsername: t.withUsername, messages: [] };
                        dms[t.withUsername].messages.push(msg.message);
                        if (activeView && activeView.type === 'dm' && activeView.withUsername === t.withUsername) renderMain();
                        else if (selectedServerId === null) renderList();
                    } else if (t.type === 'channel') {
                        const server = servers[t.serverId];
                        if (server) {
                            const ch = server.channels.find(c => c.id === t.channelId);
                            if (ch) ch.messages.push(msg.message);
                        }
                        if (activeView && activeView.type === 'channel' && activeView.channelId === t.channelId) renderMain();
                    }
                    break;
                }

                case 'presence':
                    onlineUsers = msg.online || [];
                    if (selectedServerId === null) renderList();
                    break;

                case 'voice_participants':
                    handleVoiceParticipants(msg);
                    break;

                case 'voice_peer_joined':
                    handleVoicePeerJoined(msg);
                    break;

                case 'voice_peer_left':
                    handleVoicePeerLeft(msg);
                    break;

                case 'voice_signal':
                    handleVoiceSignal(msg);
                    break;

                case 'error':
                    if (window.appLog) window.appLog('ERR_CHAT', msg.message);
                    break;
            }
        }

        if (window.appLog) window.appLog('INFO_CHAT', 'Chat app opened');

        if (typeof WindowManager !== 'undefined' && winId) {
            WindowManager.registerCleanup(winId, () => {
                if (voiceConnection) {
                    voiceConnection.peers.forEach((peer, username) => removePeer(username));
                    if (voiceConnection.localStream) voiceConnection.localStream.getTracks().forEach(t => t.stop());
                    voiceConnection = null;
                }
                if (ws) { try { ws.close(); } catch (e) {} }
            });
        }
    };
})();
