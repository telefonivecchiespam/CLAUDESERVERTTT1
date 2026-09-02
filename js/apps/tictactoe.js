// Tic Tac Toe - Singleplayer vs Bot & Multiplayer via WebSocket
// ip https://cautious-pancake-69qj4pq9rpp73xrvr-8080.app.github.dev/
(function() {
    window.initTictactoe = function(container) {
        container.innerHTML = '';
        const title = document.createElement('div');
        title.textContent = 'Tic Tac Toe';
        title.style.cssText = 'font-family:"Segoe UI",sans-serif;font-size:14px;font-weight:bold;padding:6px 10px;background:#c0c0c0;border-bottom:2px solid;border-color:#fff #808080 #808080 #fff;';
        container.appendChild(title);

        const gameDiv = document.createElement('div');
        gameDiv.style.cssText = 'padding:10px;display:flex;flex-direction:column;align-items:center;gap:8px;';

        // Mode selection
        const modeDiv = document.createElement('div');
        modeDiv.style.cssText = 'display:flex;gap:6px;margin-bottom:4px;';
        const singleBtn = document.createElement('button');
        singleBtn.textContent = 'Singleplayer';
        const multiBtn = document.createElement('button');
        multiBtn.textContent = 'Multiplayer';
        [singleBtn, multiBtn].forEach(b => {
            b.style.cssText = 'padding:3px 10px;font-size:12px;font-family:"Segoe UI",sans-serif;border:2px outset #c0c0c0;background:#c0c0c0;cursor:pointer;border-color:#fff #808080 #808080 #fff;';
            b.onmousedown = () => { b.style.border = '2px inset #c0c0c0'; };
            b.onmouseup = () => { b.style.border = '2px outset #c0c0c0'; };
        });
        modeDiv.appendChild(singleBtn);
        modeDiv.appendChild(multiBtn);
        gameDiv.appendChild(modeDiv);

        // Room selection UI
        const roomDiv = document.createElement('div');
        roomDiv.style.cssText = 'display:none;flex-direction:column;align-items:center;gap:4px;';

        // Room creation section
        const createDiv = document.createElement('div');
        createDiv.style.cssText = 'width:100%;text-align:center;margin-bottom:8px;';
        const createLabel = document.createElement('div');
        createLabel.textContent = 'Create Game Room';
        createLabel.style.cssText = 'font-weight:bold;margin-bottom:4px;';
        const createUsernameInput = document.createElement('input');
        createUsernameInput.placeholder = 'Enter username';
        createUsernameInput.style.cssText = 'padding:3px 6px;font-size:12px;font-family:"Segoe UI",sans-serif;border:2px inset #c0c0c0;background:#fff;margin-bottom:4px;max-width:150px;';
        const createRoomBtn = document.createElement('button');
        createRoomBtn.textContent = 'Create Room';
        createRoomBtn.style.cssText = 'padding:3px 12px;font-size:12px;font-family:"Segoe UI",sans-serif;border:2px outset #c0c0c0;background:#c0c0c0;cursor:pointer;border-color:#fff #808080 #808080 #fff;';
        createRoomBtn.onmousedown = () => { createRoomBtn.style.border = '2px inset #c0c0c0'; };
        createRoomBtn.onmouseup = () => { createRoomBtn.style.border = '2px outset #c0c0c0'; };
        createDiv.appendChild(createLabel);
        createDiv.appendChild(createUsernameInput);
        createDiv.appendChild(createRoomBtn);

        // Room joining section
        const joinDiv = document.createElement('div');
        joinDiv.style.cssText = 'width:100%;text-align:center;margin-top:8px;';
        const joinLabel = document.createElement('div');
        joinLabel.textContent = 'Join Game Room';
        joinLabel.style.cssText = 'font-weight:bold;margin-bottom:4px;';
        const userInput = document.createElement('input');
        userInput.placeholder = 'Enter username';
        userInput.style.cssText = 'padding:3px 6px;font-size:12px;font-family:"Segoe UI",sans-serif;border:2px inset #c0c0c0;background:#fff;margin-bottom:4px;max-width:150px;';
        const joinRoomCodeInput = document.createElement('input');
        joinRoomCodeInput.placeholder = 'Enter room code';
        joinRoomCodeInput.style.cssText = 'padding:3px 6px;font-size:12px;font-family:"Segoe UI",sans-serif;border:2px inset #c0c0c0;background:#fff;margin-bottom:4px;max-width:150px;text-transform:uppercase;';
        // Room codes are always uppercase server-side - transform as the user types so
        // Caps Lock is never needed.
        joinRoomCodeInput.addEventListener('input', () => {
            const pos = joinRoomCodeInput.selectionStart;
            joinRoomCodeInput.value = joinRoomCodeInput.value.toUpperCase();
            joinRoomCodeInput.setSelectionRange(pos, pos);
        });
        const connectBtn = document.createElement('button');
        connectBtn.textContent = 'Connect';
        connectBtn.style.cssText = 'padding:3px 12px;font-size:12px;font-family:"Segoe UI",sans-serif;border:2px outset #c0c0c0;background:#c0c0c0;cursor:pointer;border-color:#fff #808080 #808080 #fff;';
        connectBtn.onmousedown = () => { connectBtn.style.border = '2px inset #c0c0c0'; };
        connectBtn.onmouseup = () => { connectBtn.style.border = '2px outset #c0c0c0'; };
        joinDiv.appendChild(joinLabel);
        joinDiv.appendChild(userInput);
        joinDiv.appendChild(joinRoomCodeInput);
        joinDiv.appendChild(connectBtn);

        const sleepNotice = document.createElement('div');
        sleepNotice.textContent = 'Nota: il server potrebbe essere "addormentato" se inattivo da un po\' (max ogni 3 ore si risveglia da solo) - la prima connessione può richiedere fino a 30-60 secondi.';
        sleepNotice.style.cssText = 'font-size:13px;color:#666;text-align:center;max-width:220px;margin-top:8px;';

        roomDiv.appendChild(createDiv);
        roomDiv.appendChild(joinDiv);
        roomDiv.appendChild(sleepNotice);
        gameDiv.appendChild(roomDiv);

        // Status
        const status = document.createElement('div');
        status.textContent = 'Choose a mode';
        status.style.cssText = 'font-size:12px;font-family:"Segoe UI",sans-serif;padding:4px 8px;color:#000;';
        gameDiv.appendChild(status);

        // In‑app log UI
        const logDiv = document.createElement('div');
        logDiv.style.cssText = 'font-size:11px;font-family:"Segoe UI",sans-serif;padding:4px 8px;color:#555;max-height:80px;overflow-y:auto;background:#f0f0f0;border:1px solid #ccc;margin-top:4px;width:100%;';
        gameDiv.appendChild(logDiv);
        function clientLog(msg) {
            const entry = document.createElement('div');
            entry.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
            logDiv.appendChild(entry);
            // Auto‑scroll
            logDiv.scrollTop = logDiv.scrollHeight;
            // Also push to global appLog if available
            if (window.appLog) {
                window.appLog('INFO_TTT', msg);
            }
        }

        // Board
        const board = document.createElement('div');
        board.style.cssText = 'display:grid;grid-template-columns:repeat(3,60px);gap:2px;padding:4px;background:#808080;border:2px solid #808080;border-color:#808080 #fff #fff #808080;';
        const cells = [];
        for (let i = 0; i < 9; i++) {
            const cell = document.createElement('div');
            cell.style.cssText = 'width:60px;height:60px;display:flex;align-items:center;justify-content:center;font-size:28px;font-weight:bold;font-family:Arial,sans-serif;background:#c0c0c0;border:2px solid;border-color:#fff #808080 #808080 #fff;cursor:pointer;user-select:none;';
            cell.dataset.index = i;
            board.appendChild(cell);
            cells.push(cell);
        }
        gameDiv.appendChild(board);

        // Buttons
        const btnDiv = document.createElement('div');
        btnDiv.style.cssText = 'display:flex;gap:6px;';
        const resetBtn = document.createElement('button');
        resetBtn.textContent = 'Reset';
        resetBtn.style.cssText = 'padding:3px 12px;font-size:12px;font-family:"Segoe UI",sans-serif;border:2px outset #c0c0c0;background:#c0c0c0;cursor:pointer;border-color:#fff #808080 #808080 #fff;';
        resetBtn.onmousedown = () => { resetBtn.style.border = '2px inset #c0c0c0'; };
        resetBtn.onmouseup = () => { resetBtn.style.border = '2px outset #c0c0c0'; };
        btnDiv.appendChild(resetBtn);
        gameDiv.appendChild(btnDiv);

        container.appendChild(gameDiv);

        // Game state
        let currentGame = null; // { mode, board, current, winner, mySymbol, ws, username, opponent }
        // WebSocket URL for public deployment
        const wsUrl = window.TIC_TAC_TOE_WS_URL || 'wss://cautious-pancake-69qj4pq9rpp73xrvr-8080.app.github.dev/ws/tictactoe';

        // Singleplayer mode
        function startSingleplayer() {
            currentGame = {
                mode: 'single',
                board: Array(9).fill(null),
                current: 'X',
                winner: null,
                mySymbol: 'X'
            };
            status.textContent = "Your turn (X)";
            resetBoardUI();
        }

        // Multiplayer mode
        let socket = null;
        function startMultiplayer() {
            roomDiv.style.display = 'flex';
            status.textContent = 'Enter username and connect';
            if (socket) { socket.close(); socket = null; }
            currentGame = { mode: 'multi', board: [], current: null, winner: null, mySymbol: null, ws: null, username: '', opponent: null };
            resetBoardUI();
        }

        function connectMultiplayer() {
            const username = userInput.value.trim();
            const roomCode = joinRoomCodeInput.value.trim().toUpperCase();
            if (!username) { status.textContent = 'Enter a username'; return; }
            if (!roomCode) { status.textContent = 'Enter a room code'; return; }

            clientLog(`Connecting to server: ${wsUrl}`);
            currentGame.username = username;
            currentGame.roomCode = roomCode;
            status.textContent = 'Connecting...';

            socket = new WebSocket(wsUrl);
            socket.onopen = () => {
                clientLog(`WebSocket opened, joining room ${roomCode} as ${username}`);
                socket.send(JSON.stringify({ type: 'join', username, roomCode }));
            };
            socket.onmessage = (e) => {
                const msg = JSON.parse(e.data);
                handleServerMessage(msg);
            };
            socket.onclose = () => {
                clientLog('WebSocket closed');
                if (currentGame && currentGame.mode === 'multi') {
                    status.textContent = 'Disconnected';
                    currentGame.ws = null;
                }
            };
            socket.onerror = (err) => {
                clientLog('WebSocket error');
                if (currentGame && currentGame.mode === 'multi') {
                    status.textContent = 'Connection error — using offline mode';
                }
            };
            currentGame.ws = socket;
        }

        function handleServerMessage(msg) {
            if (!currentGame || currentGame.mode !== 'multi') return;
            switch (msg.type) {
                case 'room_created':
                    status.textContent = `Room ${msg.room} created. Waiting for opponent...`;
                    clientLog(`Room ${msg.room} created`);
                    break;
                case 'room_joined':
                    status.textContent = `Joined room ${msg.room}. ${msg.opponent}`;
                    clientLog(`Joined room ${msg.room}`);
                    break;
                case 'error':
                    status.textContent = `Error: ${msg.message}`;
                    clientLog(`Server error: ${msg.message}`);
                    break;
                case 'game_start':
                    clientLog(`Game started: you are ${msg.symbol}, opponent ${msg.opponent}`);
                    currentGame.mySymbol = msg.symbol;
                    currentGame.current = msg.current;
                    currentGame.board = Array(9).fill(null);
                    currentGame.opponent = msg.opponent;
                    currentGame.winner = null;
                    resetBoardUI();
                    if (currentGame.current !== currentGame.mySymbol) {
                        status.textContent = `Game vs ${currentGame.opponent}. Waiting for opponent...`;
                    } else {
                        status.textContent = `Your turn (${currentGame.mySymbol}) vs ${currentGame.opponent}`;
                    }
                    break;
                case 'move':
                    currentGame.board[msg.index] = msg.symbol;
                    renderCell(msg.index, msg.symbol);
                    clientLog(`Received move ${msg.index} (${msg.symbol})`);
                    currentGame.current = msg.next;
                    if (checkWinner(currentGame.board)) {
                        const w = checkWinner(currentGame.board);
                        currentGame.winner = w;
                        status.textContent = w === currentGame.mySymbol ? 'You win!' : `${currentGame.opponent} wins!`;
                        // Highlight win in appropriate color (yellow for my win, red for opponent)
                        const winColor = (w === currentGame.mySymbol) ? '#ff0' : '#f00';
                        const winIndices = checkWinner(currentGame.board);
                        if (winIndices) highlightWin(winIndices, winColor);
                    } else if (currentGame.board.every(c => c)) {
                        currentGame.winner = 'draw';
                        status.textContent = "It's a draw!";
                    } else {
                        if (currentGame.current === currentGame.mySymbol) {
                            status.textContent = `Your turn (${currentGame.mySymbol})`;
                        } else {
                            status.textContent = `Waiting for ${currentGame.opponent}...`;
                        }
                    }
                    break;
                case 'opponent_left':
                    status.textContent = 'Opponent disconnected';
                    currentGame.winner = 'abandoned';
                    break;
                case 'game_over':
                    currentGame.winner = msg.winner;
                    if (msg.winner === 'draw') {
                        status.textContent = "It's a draw!";
                    } else if (msg.winner === currentGame.mySymbol) {
                        status.textContent = 'You win!';
                        // Highlight win in yellow for your win
                        const winIndices = checkWinner(currentGame.board);
                        if (winIndices) highlightWin(winIndices, '#ff0');
                    } else {
                        status.textContent = `${currentGame.opponent} wins!`;
                        // Highlight opponent win in red
                        const winIndices = checkWinner(currentGame.board);
                        if (winIndices) highlightWin(winIndices, '#f00');
                    }
                    break;
            }
        }

        function makeMultiplayerMove(index) {
            if (!currentGame || currentGame.mode !== 'multi' || currentGame.winner || currentGame.board[index] || currentGame.current !== currentGame.mySymbol) return;
            // Optimistically update UI for your own move
            currentGame.board[index] = currentGame.mySymbol;
            renderCell(index, currentGame.mySymbol);
            // Check for immediate win/draw before sending (optional but keeps UI responsive)
            if (checkWinner(currentGame.board)) {
                const w = checkWinner(currentGame.board);
                currentGame.winner = w;
                status.textContent = w === currentGame.mySymbol ? 'You win!' : `${currentGame.opponent} wins!`;
                // Still send move so opponent sees it (server will also broadcast game_over)
            } else if (currentGame.board.every(c => c)) {
                currentGame.winner = 'draw';
                status.textContent = "It's a draw!";
            } else {
                // Switch turn locally
                currentGame.current = (currentGame.mySymbol === 'X' ? 'O' : 'X');
                status.textContent = `Waiting for ${currentGame.opponent}...`;
            }
            if (socket && socket.readyState === WebSocket.OPEN) {
                socket.send(JSON.stringify({ type: 'move', index }));
            }
        }

        // Board UI
        function resetBoardUI() {
            cells.forEach((c, i) => {
                c.textContent = '';
                c.style.borderColor = '#fff #808080 #808080 #fff';
                c.style.background = '#c0c0c0';
                c.onclick = () => {
                    if (currentGame && currentGame.mode === 'single' && !currentGame.board[i] && !currentGame.winner) {
                        handleSingleMove(i);
                    } else if (currentGame && currentGame.mode === 'multi') {
                        makeMultiplayerMove(i);
                    }
                };
            });
            if (currentGame && currentGame.mode === 'multi' && currentGame.board.length) {
                currentGame.board.forEach((v, i) => { if (v) renderCell(i, v); });
            }
        }

        function renderCell(i, symbol) {
            cells[i].textContent = symbol;
            cells[i].style.cursor = 'default';
            cells[i].style.borderColor = '#808080 #fff #fff #808080';
            cells[i].style.background = symbol ? '#e0e0e0' : '#c0c0c0';
        }

        // Singleplayer logic
        function handleSingleMove(index) {
            if (!currentGame || currentGame.mode !== 'single' || currentGame.board[index] || currentGame.winner) return;
            currentGame.board[index] = currentGame.current;
            renderCell(index, currentGame.current);
            const w = checkWinner(currentGame.board);
            if (w) {
                currentGame.winner = currentGame.current;
                status.textContent = currentGame.current === 'X' ? 'You win!' : 'Bot wins!';
                highlightWin(w);
                return;
            }
            if (currentGame.board.every(c => c)) {
                currentGame.winner = 'draw';
                status.textContent = "It's a draw!";
                return;
            }
            currentGame.current = 'O';
            status.textContent = 'Bot thinking...';
            // Bot move (simple minimax or blocking)
            setTimeout(() => {
                if (!currentGame || currentGame.mode !== 'single' || currentGame.winner) return;
                const move = getBestMove(currentGame.board);
                if (move !== -1) {
                    currentGame.board[move] = 'O';
                    renderCell(move, 'O');
                    const w2 = checkWinner(currentGame.board);
                    if (w2) {
                        currentGame.winner = 'O';
                        status.textContent = 'Bot wins!';
                        highlightWin(w2);
                    } else if (currentGame.board.every(c => c)) {
                        currentGame.winner = 'draw';
                        status.textContent = "It's a draw!";
                    } else {
                        currentGame.current = 'X';
                        status.textContent = 'Your turn (X)';
                    }
                }
            }, 500 + Math.random() * 500);
        }

        function checkWinner(b) {
            const wins = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
            for (const [a,b2,c] of wins) {
                if (b[a] && b[a] === b[b2] && b[a] === b[c]) {
                    return [a, b2, c];
                }
            }
            return null;
        }

        function highlightWin(indices, color = '#ff0') {
            const bg = color;
            indices.forEach(i => {
                cells[i].style.background = bg;
                cells[i].style.borderColor = '#000';
            });
        }

        function getBestMove(b) {
            // Try win
            for (let i = 0; i < 9; i++) {
                if (!b[i]) {
                    b[i] = 'O';
                    if (checkWinner(b)) { b[i] = null; return i; }
                    b[i] = null;
                }
            }
            // Block
            for (let i = 0; i < 9; i++) {
                if (!b[i]) {
                    b[i] = 'X';
                    if (checkWinner(b)) { b[i] = null; return i; }
                    b[i] = null;
                }
            }
            // Center
            if (!b[4]) return 4;
            // Corners
            const corners = [0,2,6,8];
            const availCorners = corners.filter(c => !b[c]);
            if (availCorners.length) return availCorners[Math.floor(Math.random()*availCorners.length)];
            // Sides
            const sides = [1,3,5,7];
            const availSides = sides.filter(c => !b[c]);
            if (availSides.length) return availSides[Math.floor(Math.random()*availSides.length)];
            return -1;
        }

        // Event listeners
        resetBtn.addEventListener('click', () => {
            if (currentGame && currentGame.mode === 'single') {
                startSingleplayer();
            } else if (currentGame && currentGame.mode === 'multi') {
                if (socket) { socket.close(); socket = null; }
                roomDiv.style.display = 'flex';
                createUsernameInput.value = '';
                userInput.value = '';
                joinRoomCodeInput.value = '';
                status.textContent = 'Enter username and connect';
                currentGame.ws = null;
                currentGame.board = [];
                currentGame.winner = null;
                resetBoardUI();
            }
        });

        singleBtn.addEventListener('click', () => {
            singleBtn.style.border = '2px inset #c0c0c0';
            multiBtn.style.border = '2px outset #c0c0c0';
            roomDiv.style.display = 'none';
            startSingleplayer();
        });

        multiBtn.addEventListener('click', () => {
            multiBtn.style.border = '2px inset #c0c0c0';
            singleBtn.style.border = '2px outset #c0c0c0';
            startMultiplayer();
        });

        createRoomBtn.addEventListener('click', () => {
            const username = createUsernameInput.value.trim();
            if (!username) { status.textContent = 'Enter a username'; return; }

            clientLog(`Creating room as ${username}`);
            status.textContent = 'Creating room...';
            if (socket) { socket.close(); socket = null; }

            socket = new WebSocket(wsUrl);
            socket.onopen = () => {
                clientLog('WebSocket opened for room creation');
                socket.send(JSON.stringify({ type: 'create', username }));
            };
            socket.onmessage = (e) => {
                const msg = JSON.parse(e.data);
                handleServerMessage(msg);
            };
            socket.onclose = () => {
                clientLog('WebSocket closed after create');
                status.textContent = 'Disconnected';
            };
            socket.onerror = () => {
                clientLog('WebSocket error during create');
                status.textContent = 'Connection error';
            };
            currentGame.ws = socket;
        });

        connectBtn.addEventListener('click', connectMultiplayer);
        userInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') connectMultiplayer();
        });
        joinRoomCodeInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') connectMultiplayer();
        });

        // Init
        singleBtn.style.border = '2px inset #c0c0c0';
        startSingleplayer();
    };
})();
