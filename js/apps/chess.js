// Chess Game - Windows 7 Clone Integration
(function() {
    window.initChess = function(container) {
        container.innerHTML = '';

        // Title bar
        const title = document.createElement('div');
        title.textContent = 'Chess';
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

        // Status
        const status = document.createElement('div');
        status.id = 'chess-status';
        status.textContent = 'White to move';
        status.style.cssText = 'font-size:12px;font-family:"Segoe UI",sans-serif;padding:4px 8px;color:#000;';
        gameDiv.appendChild(status);

        // Board container
        const boardContainer = document.createElement('div');
        boardContainer.id = 'chess-board';
        boardContainer.style.cssText = 'display:grid;grid-template-columns:repeat(8,50px);grid-template-rows:repeat(8,50px);border:2px solid #808080;';
        gameDiv.appendChild(boardContainer);

        // Captured pieces display
        const capturedDiv = document.createElement('div');
        capturedDiv.id = 'chess-captured';
        capturedDiv.style.cssText = 'font-size:11px;min-height:18px;';
        gameDiv.appendChild(capturedDiv);

        // Reset button
        const resetBtn = document.createElement('button');
        resetBtn.textContent = 'New Game';
        resetBtn.style.cssText = 'padding:3px 12px;font-size:12px;font-family:"Segoe UI",sans-serif;border:2px outset #c0c0c0;background:#c0c0c0;cursor:pointer;border-color:#fff #808080 #808080 #fff;';
        resetBtn.onmousedown = () => { resetBtn.style.border = '2px inset #c0c0c0'; };
        resetBtn.onmouseup = () => { resetBtn.style.border = '2px outset #c0c0c0'; };
        resetBtn.onclick = () => {
            initializeBoard();
            status.textContent = 'White to move';
            status.style.color = '#000';
            if (ws) { ws.close(); ws = null; }
            mySymbol = null;
            opponent = null;
        };
        gameDiv.appendChild(resetBtn);

        // Multiplayer UI (hidden by default) - mirrors the Tic Tac Toe layout
        const multiplayerDiv = document.createElement('div');
        multiplayerDiv.style.cssText = 'display:none;flex-direction:column;align-items:center;gap:4px;width:100%;';

        // --- Create Game Room section ---
        const createDiv = document.createElement('div');
        createDiv.style.cssText = 'width:100%;text-align:center;margin-bottom:8px;';
        const createLabel = document.createElement('div');
        createLabel.textContent = 'Create Game Room';
        createLabel.style.cssText = 'font-weight:bold;margin-bottom:4px;font-size:12px;font-family:"Segoe UI",sans-serif;';
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

        // --- Join Game Room section ---
        const joinDiv = document.createElement('div');
        joinDiv.style.cssText = 'width:100%;text-align:center;margin-top:8px;';
        const joinLabel = document.createElement('div');
        joinLabel.textContent = 'Join Game Room';
        joinLabel.style.cssText = 'font-weight:bold;margin-bottom:4px;font-size:12px;font-family:"Segoe UI",sans-serif;';
        const joinUsernameInput = document.createElement('input');
        joinUsernameInput.placeholder = 'Enter username';
        joinUsernameInput.style.cssText = 'padding:3px 6px;font-size:12px;font-family:"Segoe UI",sans-serif;border:2px inset #c0c0c0;background:#fff;margin-bottom:4px;max-width:150px;';
        const roomCodeInput = document.createElement('input');
        roomCodeInput.placeholder = 'Enter room code';
        roomCodeInput.style.cssText = 'padding:3px 6px;font-size:12px;font-family:"Segoe UI",sans-serif;border:2px inset #c0c0c0;background:#fff;margin-bottom:4px;max-width:150px;text-transform:uppercase;';
        // Room codes are always uppercase server-side - transform as the user types so
        // Caps Lock is never needed.
        roomCodeInput.addEventListener('input', () => {
            const pos = roomCodeInput.selectionStart;
            roomCodeInput.value = roomCodeInput.value.toUpperCase();
            roomCodeInput.setSelectionRange(pos, pos);
        });
        const joinRoomBtn = document.createElement('button');
        joinRoomBtn.textContent = 'Join Room';
        joinRoomBtn.style.cssText = 'padding:3px 12px;font-size:12px;font-family:"Segoe UI",sans-serif;border:2px outset #c0c0c0;background:#c0c0c0;cursor:pointer;border-color:#fff #808080 #808080 #fff;';
        joinRoomBtn.onmousedown = () => { joinRoomBtn.style.border = '2px inset #c0c0c0'; };
        joinRoomBtn.onmouseup = () => { joinRoomBtn.style.border = '2px outset #c0c0c0'; };
        joinDiv.appendChild(joinLabel);
        joinDiv.appendChild(joinUsernameInput);
        joinDiv.appendChild(roomCodeInput);
        joinDiv.appendChild(joinRoomBtn);

        const sleepNotice = document.createElement('div');
        sleepNotice.textContent = 'Nota: il server potrebbe essere "addormentato" se inattivo da un po\' (max ogni 3 ore si risveglia da solo) - la prima connessione può richiedere fino a 30-60 secondi.';
        sleepNotice.style.cssText = 'font-size:13px;color:#666;text-align:center;max-width:220px;margin-top:8px;';

        multiplayerDiv.appendChild(createDiv);
        multiplayerDiv.appendChild(joinDiv);
        multiplayerDiv.appendChild(sleepNotice);
        gameDiv.appendChild(multiplayerDiv);

        container.appendChild(gameDiv);

        // ===== WebSocket =====
        let ws = null;
        let mySymbol = null;
        let opponent = null;
        const wsUrl = window.CHESS_WS_URL || 'wss://cautious-pancake-69qj4pq9rpp73xrvr-8080.app.github.dev/ws/chess';

        function connectWS() {
            ws = new WebSocket(wsUrl);
            ws.onopen = () => {
                status.textContent = 'Connected to server';
            };
            ws.onmessage = (e) => {
                const msg = JSON.parse(e.data);
                handleServerMessage(msg);
            };
            ws.onclose = () => {
                status.textContent = 'Disconnected';
                mySymbol = null;
                opponent = null;
            };
        }

        function handleServerMessage(msg) {
            switch (msg.type) {
                case 'chess_game_start':
                    mySymbol = msg.symbol;
                    opponent = msg.opponent;
                    // Chess always starts with White to move, regardless of which
                    // color *I* am - don't confuse "my symbol" with "whose turn it is".
                    currentPlayer = 'white';
                    // Update status – only show waiting if we haven't got an opponent yet
                    if (opponent) {
                        status.textContent = (mySymbol === 'white' ? 'You are White' : 'You are Black') + ' (Opponent: ' + opponent + ')';
                        if (window.appLog) window.appLog('INFO_CHESS', 'Game started, opponent: ' + opponent);
                    } else if (!status.textContent.includes('Opponent')) {
                        status.textContent = (mySymbol === 'white' ? 'You are White' : 'You are Black') + ' (Waiting for opponent…)';
                    }
                    if (msg.room) {
                        status.textContent += ' (Room: ' + msg.room + ')';
                    }
                    break;
                case 'chess_move':
                    // executeMove() already sets the correct status text itself
                    // (whose turn it is, check, checkmate, stalemate) - don't
                    // clobber it with a generic "Your turn" afterwards.
                    executeMove(msg.fromRow, msg.fromCol, msg.toRow, msg.toCol);
                    break;
                case 'game_over':
                    status.textContent = msg.winner === mySymbol ? 'You win!' : (msg.winner === 'draw' ? "It's a draw!" : 'You lose');
                    if (window.appLog) window.appLog('INFO_CHESS', 'Game over: ' + status.textContent);
                    break;
                case 'turn':
                    if (!gameOver && msg.currentPlayer !== mySymbol) {
                        status.textContent = "Opponent's turn";
                    }
                    break;
                case 'room_created':
                    status.textContent = 'Room ' + msg.room + ' created. Waiting for opponent...';
                    if (window.appLog) window.appLog('INFO_CHESS', 'Room ' + msg.room + ' created');
                    break;
                case 'opponent_left':
                    status.textContent = 'Opponent disconnected';
                    status.style.color = '#d00';
                    gameOver = true;
                    renderBoard();
                    if (window.appLog) window.appLog('WARN_CHESS', 'Opponent disconnected');
                    break;
                case 'error':
                    status.textContent = 'Error: ' + msg.message;
                    if (window.appLog) window.appLog('ERR_CHESS', msg.message);
                    break;
                default:
                    break;
            }
        }

        // UI button handlers
        createRoomBtn.onclick = () => {
            const username = createUsernameInput.value.trim();
            if (!username) { status.textContent = 'Enter username'; return; }
            connectWS();
            ws.onopen = () => {
                ws.send(JSON.stringify({ type: 'chess_create', username }));
                status.textContent = 'Creating room...';
            };
        };

        joinRoomBtn.onclick = () => {
            const username = joinUsernameInput.value.trim();
            const roomCode = roomCodeInput.value.trim().toUpperCase();
            if (!username || !roomCode) { status.textContent = 'Enter username and room code'; return; }
            connectWS();
            ws.onopen = () => {
                ws.send(JSON.stringify({ type: 'chess_join', username, roomCode }));
                status.textContent = 'Joining room...';
            };
        };

        // ===== Game State =====
        let board = [];
        let currentPlayer = 'white';
        let selectedSquare = null;
        let captured = [];
        let gameOver = false;
        let lastMove = null;

        // ===== Constants =====
        const PIECE_SYMBOLS = {
            'K':'♔','Q':'♕','R':'♖','B':'♗','N':'♘','P':'♙',
            'k':'♚','q':'♛','r':'♜','b':'♝','n':'♞','p':'♟'
        };

        // ===== Board Initialization =====
        function initBoardArray() {
            return [
                ['r','n','b','q','k','b','n','r'],
                ['p','p','p','p','p','p','p','p'],
                [null,null,null,null,null,null,null,null],
                [null,null,null,null,null,null,null,null],
                [null,null,null,null,null,null,null,null],
                [null,null,null,null,null,null,null,null],
                ['P','P','P','P','P','P','P','P'],
                ['R','N','B','Q','K','B','N','R']
            ];
        }

        function initializeBoard() {
            board = initBoardArray();
            currentPlayer = 'white';
            selectedSquare = null;
            captured = [];
            gameOver = false;
            lastMove = null;
            renderBoard();
        }

        // ===== Rendering =====
        function renderBoard() {
            boardContainer.innerHTML = '';
            for (let row = 0; row < 8; row++) {
                for (let col = 0; col < 8; col++) {
                    const sq = document.createElement('div');
                    sq.className = 'chess-square';
                    sq.dataset.row = row;
                    sq.dataset.col = col;
                    sq.style.cssText = 'display:flex;align-items:center;justify-content:center;font-size:32px;cursor:pointer;background:' +
                        ((row + col) % 2 === 0 ? '#f0d9b5' : '#b58863') +
                        ';border:1px solid #c0c0c0';
                    const piece = board[row][col];
                    if (piece) {
                        const pieceEl = document.createElement('span');
                        pieceEl.textContent = PIECE_SYMBOLS[piece] || piece;
                        pieceEl.style.fontSize = '32px';
                        sq.appendChild(pieceEl);
                    }
                    if (selectedSquare && selectedSquare[0] === row && selectedSquare[1] === col) {
                        sq.style.background = '#7fc97f';
                    }
                    if (lastMove) {
                        if ((lastMove.fromRow === row && lastMove.fromCol === col) ||
                            (lastMove.toRow === row && lastMove.toCol === col)) {
                            sq.style.background = '#cdd26a';
                        }
                    }
                    sq.addEventListener('click', handleSquareClick);
                    boardContainer.appendChild(sq);
                }
            }

            // Update captured pieces
            const capEl = document.getElementById('chess-captured');
            if (captured.length > 0) {
                capEl.textContent = 'Captured: ' + captured.map(c => PIECE_SYMBOLS[c] || c).join(' ');
            } else {
                capEl.textContent = '';
            }
        }

        // ===== Click Handler =====
        function handleSquareClick(e) {
            if (gameOver) return;
            const row = parseInt(e.currentTarget.dataset.row);
            const col = parseInt(e.currentTarget.dataset.col);
            const piece = board[row][col];

            if (selectedSquare) {
                const [fromRow, fromCol] = selectedSquare;
                if (piece && isOwnPiece(piece, currentPlayer)) {
                    selectedSquare = [row, col];
                    renderBoard();
                    return;
                }
                if (isValidMove(fromRow, fromCol, row, col)) {
                    if (ws && mySymbol) {
                        makeMultiplayerMove(fromRow, fromCol, row, col);
                    } else {
                        // In singleplayer mode only allow white moves from user
                        if (currentPlayer !== 'white') {
                            // ignore illegal black manual move
                            selectedSquare = null;
                            renderBoard();
                            return;
                        }
                        executeMove(fromRow, fromCol, row, col);
                        // AI move for singleplayer (black)
                        if (!gameOver && currentPlayer === 'black') {
                            makeAIMove();
                        }
                    }
                }
                selectedSquare = null;
                renderBoard();
            } else {
                if (piece && isOwnPiece(piece, currentPlayer)) {
                    selectedSquare = [row, col];
                    renderBoard();
                }
            }
        }

        // ===== AI Move (Singleplayer) =====
        function makeAIMove() {
            if (gameOver || currentPlayer !== 'black') return;
            const allMoves = [];
            for (let r = 0; r < 8; r++) {
                for (let c = 0; c < 8; c++) {
                    if (board[r][c] && isOwnPiece(board[r][c], 'black')) {
                        for (let tr = 0; tr < 8; tr++) {
                            for (let tc = 0; tc < 8; tc++) {
                                if (isValidMove(r, c, tr, tc)) {
                                    allMoves.push({ fr: r, fc: c, tr: tr, tc: tc });
                                }
                            }
                        }
                    }
                }
            }
            if (allMoves.length > 0) {
                const move = allMoves[Math.floor(Math.random() * allMoves.length)];
                executeMove(move.fr, move.fc, move.tr, move.tc);
            }
        }

        // ===== Multiplayer Move =====
        function makeMultiplayerMove(fr, fc, tr, tc) {
            if (mySymbol !== currentPlayer) return;
            ws.send(JSON.stringify({ type: 'chess_move', fromRow: fr, fromCol: fc, toRow: tr, toCol: tc }));
            executeMove(fr, fc, tr, tc);
        }

        // ===== Color Check =====
        function isWhite(pieceCode) {
            return pieceCode === pieceCode.toUpperCase() && pieceCode !== pieceCode.toLowerCase();
        }

        function isOwnPiece(pieceCode, player) {
            if (!pieceCode) return false;
            return player === 'white' ? isWhite(pieceCode) : !isWhite(pieceCode);
        }

        // ===== Move Validation =====
        function isValidMove(fr, fc, tr, tc) {
            const piece = board[fr][fc];
            if (!piece) return false;
            if (isOwnPiece(piece, currentPlayer) === false) return false;
            const target = board[tr][tc];
            if (target && isOwnPiece(target, currentPlayer)) return false;

            const dr = tr - fr;
            const dc = tc - fc;
            const absDr = Math.abs(dr);
            const absDc = Math.abs(dc);
            const pt = piece.toLowerCase();

            let valid = false;
            switch (pt) {
                case 'p':
                    const dir = isWhite(piece) ? -1 : 1;
                    const startRow = isWhite(piece) ? 6 : 1;
                    if (dc === 0 && dr === dir && !target) valid = true;
                    if (dc === 0 && dr === 2 * dir && fr === startRow && !board[fr + dir][fc]) valid = true;
                    if (absDc === 1 && dr === dir && target && !isOwnPiece(target, currentPlayer)) valid = true;
                    break;
                case 'n':
                    valid = (absDr === 2 && absDc === 1) || (absDr === 1 && absDc === 2);
                    break;
                case 'b':
                    if (absDr === absDc && absDr > 0) valid = isPathClear(board, fr, fc, tr, tc);
                    break;
                case 'r':
                    if ((dr === 0 || dc === 0) && !(dr === 0 && dc === 0)) valid = isPathClearStraight(board, fr, fc, tr, tc);
                    break;
                case 'q':
                    if (absDr === absDc && absDr > 0) valid = isPathClearDiagonal(board, fr, fc, tr, tc);
                    if ((dr === 0 || dc === 0) && !(dr === 0 && dc === 0)) valid = isPathClearStraight(board, fr, fc, tr, tc);
                    break;
                case 'k':
                    valid = absDr <= 1 && absDc <= 1 && !(dr === 0 && dc === 0);
                    break;
            }
            if (!valid) return false;

            // Simulate move and check if own king is in check
            const testBoard = board.map(r => [...r]);
            testBoard[tr][tc] = testBoard[fr][fc];
            testBoard[fr][fc] = null;
            if (pt === 'p' && dc !== 0 && !testBoard[tr][tc]) testBoard[fr][tc] = null;
            if (pt === 'k' && absDc === 2) {
                if (dc > 0) { // Kingside
                    testBoard[tr][5] = testBoard[tr][7];
                    testBoard[tr][7] = null;
                } else { // Queenside
                    testBoard[tr][3] = testBoard[tr][0];
                    testBoard[tr][0] = null;
                }
            }
            if (isKingInCheck(testBoard, currentPlayer)) return false;

            return true;
        }

        function isPathClearDiagonal(board, fromRow, fromCol, toRow, toCol) {
            const stepR = toRow > fromRow ? 1 : -1;
            const stepC = toCol > fromCol ? 1 : -1;
            let r = fromRow + stepR, c = fromCol + stepC;
            while (r !== toRow || c !== toCol) {
                if (board[r][c] !== null) return false;
                r += stepR; c += stepC;
            }
            return true;
        }

        function isPathClear(board, fromRow, fromCol, toRow, toCol) {
            return isPathClearDiagonal(board, fromRow, fromCol, toRow, toCol);
        }

        function isPathClearStraight(board, fromRow, fromCol, toRow, toCol) {
            const dr = toRow - fromRow;
            const dc = toCol - fromCol;
            const stepR = dr === 0 ? 0 : (dr > 0 ? 1 : -1);
            const stepC = dc === 0 ? 0 : (dc > 0 ? 1 : -1);
            let r = fromRow + stepR, c = fromCol + stepC;
            while (r !== toRow || c !== toCol) {
                if (board[r][c] !== null) return false;
                r += stepR; c += stepC;
            }
            return true;
        }

        // ===== Check Detection =====
        function findKing(b, player) {
            const king = player === 'white' ? 'K' : 'k';
            for (let r = 0; r < 8; r++) {
                for (let c = 0; c < 8; c++) {
                    if (b[r][c] === king) return [r, c];
                }
            }
            return null;
        }

        function isKingInCheck(b, player) {
            const kingPos = findKing(b, player);
            if (!kingPos) return false;
            const [kr, kc] = kingPos;
            const opponent = player === 'white' ? 'black' : 'white';

            for (let r = 0; r < 8; r++) {
                for (let c = 0; c < 8; c++) {
                    const piece = b[r][c];
                    if (!piece || isWhite(piece) !== (opponent === 'white')) continue;
                    const pt = piece.toLowerCase();
                    const dr = kr - r, dc = kc - c;
                    const absDr = Math.abs(dr), absDc = Math.abs(dc);
                    if (pt === 'p' && absDc === 1 && dr === (isWhite(piece) ? -1 : 1)) return true;
                    if (pt === 'n' && ((absDr === 2 && absDc === 1) || (absDr === 1 && absDc === 2))) return true;
                    if (pt === 'b' && absDr === absDc && absDr > 0) {
                        let blocked = false;
                        const stepR = dr > 0 ? 1 : -1;
                        const stepC = dc > 0 ? 1 : -1;
                        let rr = r + stepR, cc = c + stepC;
                        while (rr !== kr || cc !== kc) {
                            if (b[rr][cc] !== null) { blocked = true; break; }
                            rr += stepR; cc += stepC;
                        }
                        if (!blocked) return true;
                    }
                    if (pt === 'r' && ((dr === 0 && absDc > 0) || (dc === 0 && absDr > 0))) {
                        let blocked = false;
                        const stepR = dr === 0 ? 0 : (dr > 0 ? 1 : -1);
                        const stepC = dc === 0 ? 0 : (dc > 0 ? 1 : -1);
                        let rr = r + stepR, cc = c + stepC;
                        while (rr !== kr || cc !== kc) {
                            if (b[rr][cc] !== null) { blocked = true; break; }
                            rr += stepR; cc += stepC;
                        }
                        if (!blocked) return true;
                    }
                    if (pt === 'q') {
                        if ((absDr === absDc && absDr > 0 && isPathClearDiagonal(b, r, c, kr, kc)) ||
                            ((dr === 0 || dc === 0) && !(dr === 0 && dc === 0) && isPathClearStraight(b, r, c, kr, kc))) return true;
                    }
                    if (pt === 'k' && absDr <= 1 && absDc <= 1) return true;
                }
            }
            return false;
        }

        function hasAnyLegalMoves(player) {
            for (let r = 0; r < 8; r++) {
                for (let c = 0; c < 8; c++) {
                    const piece = board[r][c];
                    if (!piece || isWhite(piece) !== (player === 'white')) continue;
                    for (let tr = 0; tr < 8; tr++) {
                        for (let tc = 0; tc < 8; tc++) {
                            if (isValidMove(r, c, tr, tc, true)) return true;
                        }
                    }
                }
            }
            return false;
        }

        // ===== Execute Move =====
        function executeMove(fr, fc, tr, tc) {
            const piece = board[fr][fc];
            if (!piece) return; // move already applied locally (or stale message) - nothing to do
            const target = board[tr][tc];
            const player = isWhite(piece) ? 'white' : 'black';

            // Track captured piece
            if (target) captured.push(target);

            // En passant capture
            if (piece.toLowerCase() === 'p' && tc !== fc && !target) {
                captured.push(board[fr][tc]);
                board[fr][tc] = null;
            }

            // Move piece
            board[tr][tc] = piece;
            board[fr][fc] = null;

            // Castling
            if (piece.toLowerCase() === 'k' && Math.abs(tc - fc) === 2) {
                if (tc > fc) { // Kingside
                    board[tr][5] = board[tr][7];
                    board[tr][7] = null;
                } else { // Queenside
                    board[tr][3] = board[tr][0];
                    board[tr][0] = null;
                }
            }

            // Pawn promotion
            if (piece.toLowerCase() === 'p' && ((isWhite(piece) && tr === 0) || (!isWhite(piece) && tr === 7))) {
                board[tr][tc] = isWhite(piece) ? 'Q' : 'q';
            }

            lastMove = { fromRow: fr, fromCol: fc, toRow: tr, toCol: tc };

            // Switch player
            currentPlayer = currentPlayer === 'white' ? 'black' : 'white';

            // Check game over
            const kingPos = findKing(board, currentPlayer);
            const inCheck = kingPos ? isKingInCheck(board, currentPlayer) : false;
            const hasMoves = hasAnyLegalMoves(currentPlayer);

            if (!hasMoves) {
                gameOver = true;
                if (inCheck) {
                    status.textContent = `${currentPlayer === 'white' ? 'Black' : 'White'} wins!`;
                    status.style.color = '#d00';
                } else {
                    status.textContent = "Stalemate! It's a draw!";
                    status.style.color = '#d00';
                }
                if (window.appLog) window.appLog('INFO_CHESS', `Game over: ${status.textContent}`);
            } else if (inCheck) {
                status.textContent = `${currentPlayer === 'white' ? 'White' : 'black'} is in check!`;
                status.style.color = '#d00';
            } else {
                status.textContent = `${currentPlayer === 'white' ? 'White' : 'black'} to move`;
                status.style.color = '#000';
            }

            renderBoard();
        }

        // ===== Mode Button Handlers =====
        singleBtn.onclick = () => {
            singleBtn.style.border = '2px inset #c0c0c0';
            multiBtn.style.border = '2px outset #c0c0c0';
            multiplayerDiv.style.display = 'none';
            status.textContent = 'White to move';
            status.style.color = '#000';
            initializeBoard();
            if (ws) { ws.close(); ws = null; }
            mySymbol = null;
            opponent = null;
        };

        multiBtn.onclick = () => {
            multiBtn.style.border = '2px inset #c0c0c0';
            singleBtn.style.border = '2px outset #c0c0c0';
            multiplayerDiv.style.display = 'flex';
            status.textContent = 'Enter username and connect';
            initializeBoard();
            if (ws) { ws.close(); ws = null; }
            mySymbol = null;
            opponent = null;
        };

        // ===== Start =====
        singleBtn.style.border = '2px inset #c0c0c0';
        initializeBoard();
        if (window.appLog) window.appLog('INFO_CHESS', 'Chess game initialized');
    };

    // Helper function for room code generation
    function generateRoomCode(length = 6) {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let result = '';
        for (let i = 0; i < length; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return result;
    }
})();
