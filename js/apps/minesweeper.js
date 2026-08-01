// Minesweeper Game - initMinesweeper(container)
(function() {
    'use strict';

    window.initMinesweeper = function(container) {
        container.innerHTML = '';
        container.style.display = 'flex';
        container.style.flexDirection = 'column';
        container.style.alignItems = 'center';
        container.style.padding = '10px';
        container.style.background = '#c0c0c0';

        const diff = { width: 9, height: 9, mines: 10 };
        let board = [];
        let gameOver = false;
        let revealed = 0;
        let flagged = 0;
        let timer = 0;
        let timerInterval = null;

        // Toolbar
        const toolbar = document.createElement('div');
        toolbar.style.cssText = 'display:flex;gap:20px;align-items:center;padding:6px 10px;background:#c0c0c0;border:2px solid; border-color:#fff #808080 #808080 #fff;margin-bottom:8px;font-family:"Segoe UI",sans-serif;font-size:14px;';
        const mineCount = document.createElement('span');
        mineCount.textContent = '010';
        mineCount.style.cssText = 'background:#000;color:red;padding:2px 6px;font-family:"Courier New",monospace;font-size:20px;font-weight:bold;border:2px solid;border-color:#808080 #fff #fff #808080;min-width:50px;text-align:center;';
        const smiley = document.createElement('span');
        smiley.textContent = '🙂';
        smiley.style.cssText = 'font-size:24px;cursor:pointer;padding:0 8px;border:2px solid;border-color:#808080 #fff #fff #808080;background:#c0c0c0;user-select:none;';
        smiley.onclick = initBoard;
        const timerDisplay = document.createElement('span');
        timerDisplay.textContent = '000';
        timerDisplay.style.cssText = 'background:#000;color:red;padding:2px 6px;font-family:"Courier New",monospace;font-size:20px;font-weight:bold;border:2px solid;border-color:#808080 #fff #fff #808080;min-width:50px;text-align:center;';
        toolbar.appendChild(mineCount);
        toolbar.appendChild(smiley);
        toolbar.appendChild(timerDisplay);
        container.appendChild(toolbar);

        // Board
        const boardDiv = document.createElement('div');
        boardDiv.id = 'minesweeper-board';
        boardDiv.style.cssText = 'display:grid;grid-template-columns:repeat(' + diff.width + ',28px);gap:1px;background:#b0b0b0;border:3px solid;border-color:#808080 #fff #fff #808080;padding:1px;';
        container.appendChild(boardDiv);

        function startTimer() {
            if (timerInterval) return;
            timerInterval = setInterval(() => {
                timer++;
                timerDisplay.textContent = String(timer).padStart(3, '0');
            }, 1000);
        }

        function stopTimer() {
            if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
        }

        function initBoard() {
            stopTimer();
            timer = 0;
            timerDisplay.textContent = '000';
            gameOver = false;
            revealed = 0;
            flagged = 0;
            smiley.textContent = '🙂';
            board = [];
            for (let y = 0; y < diff.height; y++) {
                board[y] = [];
                for (let x = 0; x < diff.width; x++) {
                    board[y][x] = { mine: false, revealed: false, flagged: false, adjacent: 0 };
                }
            }
            // Place mines
            let placed = 0;
            while (placed < diff.mines) {
                const x = Math.floor(Math.random() * diff.width);
                const y = Math.floor(Math.random() * diff.height);
                if (!board[y][x].mine) { board[y][x].mine = true; placed++; }
            }
            // Adjacent counts
            for (let y = 0; y < diff.height; y++) {
                for (let x = 0; x < diff.width; x++) {
                    if (board[y][x].mine) continue;
                    let c = 0;
                    for (let dy = -1; dy <= 1; dy++)
                        for (let dx = -1; dx <= 1; dx++) {
                            const nx = x+dx, ny = y+dy;
                            if (nx>=0 && nx<diff.width && ny>=0 && ny<diff.height && board[ny][nx].mine) c++;
                        }
                    board[y][x].adjacent = c;
                }
            }
            mineCount.textContent = String(diff.mines).padStart(3, '0');
            renderBoard();
        }

        function renderBoard() {
            boardDiv.innerHTML = '';
            for (let y = 0; y < diff.height; y++) {
                for (let x = 0; x < diff.width; x++) {
                    const cell = document.createElement('div');
                    cell.style.cssText = 'width:28px;height:28px;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:bold;cursor:pointer;border:2px solid;border-color:#fff #808080 #808080 #fff;background:#c0c0c0;user-select:none;';
                    cell.dataset.x = x;
                    cell.dataset.y = y;
                    cell.addEventListener('click', () => { if (!gameOver) { startTimer(); } revealCell(x, y); });
                    cell.addEventListener('contextmenu', (e) => { e.preventDefault(); toggleFlag(x, y, cell); });
                    boardDiv.appendChild(cell);
                }
            }
        }

        function revealCell(x, y) {
            if (gameOver) return;
            const c = board[y][x];
            if (c.revealed || c.flagged) return;
            c.revealed = true;
            revealed++;
            const div = boardDiv.children[y * diff.width + x];

            if (c.mine) {
                div.textContent = '💣';
                div.style.background = '#ff0000';
                div.style.borderColor = '#ff0000';
                gameOver = true;
                smiley.textContent = '😵';
                stopTimer();
                if (window.appLog) window.appLog('INFO_MINE', 'Game over - hit a mine at ' + timer + 's');
                // Reveal all mines
                for (let y2 = 0; y2 < diff.height; y2++)
                    for (let x2 = 0; x2 < diff.width; x2++) {
                        if (board[y2][x2].mine && !board[y2][x2].flagged) {
                            const d = boardDiv.children[y2 * diff.width + x2];
                            d.textContent = '💣';
                            d.style.background = '#c0c0c0';
                        }
                    }
                return;
            }

            div.style.borderColor = '#808080';
            div.style.background = '#b0b0b0';

            if (c.adjacent > 0) {
                const colors = ['','#0000ff','#008000','#ff0000','#000080','#800080','#008080','#000000','#808080'];
                div.textContent = c.adjacent;
                div.style.color = colors[c.adjacent] || '#000';
            } else {
                // Flood fill
                for (let dy = -1; dy <= 1; dy++)
                    for (let dx = -1; dx <= 1; dx++) {
                        if (dx === 0 && dy === 0) continue;
                        const nx = x+dx, ny = y+dy;
                        if (nx>=0 && nx<diff.width && ny>=0 && ny<diff.height) revealCell(nx, ny);
                    }
            }

            // Win check
            if (revealed >= diff.width * diff.height - diff.mines) {
                gameOver = true;
                smiley.textContent = '😎';
                stopTimer();
                if (window.appLog) window.appLog('INFO_MINE', 'You win! Time: ' + timer + 's');
            }
        }

        function toggleFlag(x, y, cell) {
            if (gameOver) return;
            const c = board[y][x];
            if (c.revealed) return;
            c.flagged = !c.flagged;
            cell.textContent = c.flagged ? '🚩' : '';
            flagged += c.flagged ? 1 : -1;
            mineCount.textContent = String(Math.max(0, diff.mines - flagged)).padStart(3, '0');
        }

        initBoard();
    };
})();
