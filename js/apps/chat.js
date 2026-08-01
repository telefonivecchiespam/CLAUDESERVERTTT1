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
        let servers = {};       // id -> server object {id,name,inviteCode,members,channels:[{id,name,messages}]}
        let dms = {};           // withUsername -> {withUsername, messages}
        let onlineUsers = [];
        let activeView = null;  // {type:'dm', withUsername} | {type:'channel', serverId, channelId}
        let selectedServerId = null; // which server is expanded in the rail (null = DM view)

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

        // ---- List column rendering (channels or DMs) ----
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
                addBtn.addEventListener('click', () => {
                    showModal('New Channel', ['Channel name'], (vals) => {
                        if (!vals[0]) return;
                        ws.send(JSON.stringify({ type: 'create_channel', serverId: server.id, name: vals[0] }));
                    });
                });
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
                    row.textContent = '# ' + ch.name;
                    row.style.cssText = 'padding:6px 8px;cursor:pointer;' + (isActive ? 'background:#000080;color:#fff;' : '');
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

        // ---- Main panel rendering ----
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

                case 'error':
                    if (window.appLog) window.appLog('ERR_CHAT', msg.message);
                    break;
            }
        }

        if (window.appLog) window.appLog('INFO_CHAT', 'Chat app opened');

        if (typeof WindowManager !== 'undefined' && winId) {
            WindowManager.registerCleanup(winId, () => {
                if (ws) { try { ws.close(); } catch (e) {} }
            });
        }
    };
})();
