// Solitaire App - Functional initSolitaire(container)
(function() {
    'use strict';

    window.initSolitaire = function(container, winId) {
        container.innerHTML = '';
        container.style.position = 'relative';
        container.style.width = '100%';
        container.style.height = '100%';
        container.style.background = '#0A5C36';
        container.style.overflow = 'auto';
        container.style.userSelect = 'none';

        // Build deck
        const suits = ['♠','♥','♦','♣'];
        const ranks = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
        const colors = { '♠':'black','♣':'black','♥':'red','♦':'red' };

        let deck = [];
        suits.forEach(suit => {
            ranks.forEach(rank => {
                deck.push({ suit, rank, color: colors[suit], faceUp: false, id: Math.random() });
            });
        });

        // Shuffle
        for (let i = deck.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [deck[i], deck[j]] = [deck[j], deck[i]];
        }

        // Game state
        const tableau = [];
        let stock = [];
        let waste = [];
        const foundation = { '♠': [], '♥': [], '♦': [], '♣': [] };
        let cardIndex = 0;
        let won = false;

        // Build tableau
        for (let i = 0; i < 7; i++) {
            const pile = [];
            for (let j = 0; j <= i; j++) {
                const card = deck[cardIndex++];
                if (j === i) card.faceUp = true;
                pile.push(card);
            }
            tableau.push(pile);
        }
        stock = deck.slice(cardIndex);
        deck = null;

        // Card dimensions
        const cardW = 60, cardH = 84, overlap = 20, gap = 10;
        let selected = null; // {source: 'tableau'|'waste', pileIdx, cardIdx, cardObj}

        function rankValue(rank) {
            const vals = { 'A':1,'2':2,'3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,'10':10,'J':11,'Q':12,'K':13 };
            return vals[rank] || 0;
        }

        function canPlaceOnFoundation(card) {
            const pile = foundation[card.suit];
            if (pile.length === 0) return card.rank === 'A';
            const top = pile[pile.length - 1];
            return rankValue(card.rank) === rankValue(top.rank) + 1;
        }

        function canPlaceOnTableau(card, destPile) {
            if (destPile.length === 0) return card.rank === 'K';
            const destTop = destPile[destPile.length - 1];
            return rankValue(destTop.rank) === rankValue(card.rank) + 1 && destTop.color !== card.color;
        }

        // Remove the selected card (and any cards stacked on top of it, for tableau)
        // from its source pile, returning the array of removed cards.
        function pluckSelection() {
            if (!selected) return [];
            if (selected.source === 'waste') {
                if (waste.length === 0) return [];
                return [waste.pop()];
            }
            const srcPile = tableau[selected.pileIdx];
            return srcPile.splice(selected.cardIdx);
        }

        function flipNewTopIfNeeded(pileIdx) {
            const pile = tableau[pileIdx];
            if (pile.length > 0) {
                const topCard = pile[pile.length - 1];
                if (!topCard.faceUp) topCard.faceUp = true;
            }
        }

        function checkWin() {
            const total = Object.values(foundation).reduce((a, b) => a + b.length, 0);
            if (total === 52 && !won) {
                won = true;
                if (window.appLog) window.appLog('INFO_SOL', 'Game won!');
            }
            return won;
        }

        // Try to move the currently selected card onto a tableau pile
        function moveSelectedToTableau(destPileIdx) {
            if (!selected) return false;
            const movingCard = selected.cardObj;
            const destPile = tableau[destPileIdx];
            if (selected.source === 'tableau' && selected.pileIdx === destPileIdx) return false;
            if (!canPlaceOnTableau(movingCard, destPile)) {
                if (window.appLog) window.appLog('WARN_SOL', 'Invalid move (color or rank mismatch)');
                return false;
            }
            const fromPileIdx = selected.source === 'tableau' ? selected.pileIdx : null;
            const moved = pluckSelection();
            if (moved.length === 0) return false;
            destPile.push(...moved);
            if (fromPileIdx !== null) flipNewTopIfNeeded(fromPileIdx);
            if (window.appLog) window.appLog('INFO_SOL', 'Moved ' + movingCard.rank + movingCard.suit + ' to pile ' + (destPileIdx + 1));
            return true;
        }

        // Try to move the currently selected single top card onto its foundation
        function moveSelectedToFoundation() {
            if (!selected) return false;
            // Only a single top card can go to the foundation, never a sub-stack
            const isTopOfSource = selected.source === 'waste' ||
                selected.pileIdx !== null && selected.cardIdx === tableau[selected.pileIdx].length - 1;
            if (!isTopOfSource) {
                if (window.appLog) window.appLog('WARN_SOL', 'Only the top card can go to the foundation');
                return false;
            }
            const movingCard = selected.cardObj;
            if (!canPlaceOnFoundation(movingCard)) {
                if (window.appLog) window.appLog('WARN_SOL', 'Card cannot go on that foundation yet');
                return false;
            }
            const fromPileIdx = selected.source === 'tableau' ? selected.pileIdx : null;
            const moved = pluckSelection();
            if (moved.length === 0) return false;
            foundation[movingCard.suit].push(moved[0]);
            if (fromPileIdx !== null) flipNewTopIfNeeded(fromPileIdx);
            if (window.appLog) window.appLog('INFO_SOL', 'Moved ' + movingCard.rank + movingCard.suit + ' to foundation');
            return true;
        }

        // Attempt to auto-send a card straight to its foundation (double-click shortcut)
        function autoSendToFoundation(source, pileIdx, cardIdx, cardObj) {
            selected = { source, pileIdx, cardIdx, cardObj };
            const moved = moveSelectedToFoundation();
            selected = null;
            if (moved) checkWin();
            render();
        }

        function selectCard(source, pileIdx, cardIdx, cardObj) {
            if (!selected) {
                selected = { source, pileIdx, cardIdx, cardObj };
                if (window.appLog) window.appLog('INFO_SOL', 'Selected ' + cardObj.rank + cardObj.suit);
                render();
                return;
            }
            // Clicking the same card again deselects it
            if (selected.source === source && selected.pileIdx === pileIdx && selected.cardIdx === cardIdx) {
                selected = null;
                render();
                return;
            }
            // Clicking another card while one is selected re-selects instead of trying to
            // treat the new card as a destination (destinations are piles/foundations, handled separately)
            selected = { source, pileIdx, cardIdx, cardObj };
            render();
        }

        function onTableauDropTarget(destPileIdx) {
            const moved = moveSelectedToTableau(destPileIdx);
            selected = null;
            if (moved) checkWin();
            render();
        }

        function onFoundationDropTarget() {
            const moved = moveSelectedToFoundation();
            selected = null;
            if (moved) checkWin();
            render();
        }

        function isSelected(source, pileIdx, cardIdx) {
            return !!selected && selected.source === source && selected.pileIdx === pileIdx && selected.cardIdx === cardIdx;
        }

        function makeDragData(source, pileIdx, cardIdx) {
            return JSON.stringify({ source, pileIdx, cardIdx });
        }

        function selectFromDragData(e) {
            let data;
            try { data = JSON.parse(e.dataTransfer.getData('text/plain')); } catch (err) { return false; }
            if (!data) return false;
            const cardObj = data.source === 'waste'
                ? waste[waste.length - 1]
                : (tableau[data.pileIdx] || [])[data.cardIdx];
            if (!cardObj) return false;
            selected = { source: data.source, pileIdx: data.pileIdx, cardIdx: data.cardIdx, cardObj };
            return true;
        }

        function render() {
            container.innerHTML = '';

            // Stock pile
            const stockDiv = document.createElement('div');
            stockDiv.style.position = 'absolute';
            stockDiv.style.left = '10px';
            stockDiv.style.top = '10px';
            if (stock.length > 0) {
                const cardEl = document.createElement('div');
                cardEl.className = 'card face-down';
                cardEl.style.width = cardW + 'px';
                cardEl.style.height = cardH + 'px';
                cardEl.style.border = '1px solid #333';
                cardEl.style.borderRadius = '4px';
                cardEl.style.background = '#1A5FB4';
                cardEl.style.cursor = 'pointer';
                cardEl.addEventListener('click', () => {
                    if (stock.length > 0) {
                        const card = stock.pop();
                        card.faceUp = true;
                        waste.push(card);
                        if (window.appLog) window.appLog('INFO_SOL', 'Drew card from stock');
                        render();
                    }
                });
                stockDiv.appendChild(cardEl);
            } else {
                const emptyEl = document.createElement('div');
                emptyEl.style.width = cardW + 'px';
                emptyEl.style.height = cardH + 'px';
                emptyEl.style.border = '2px dashed #fff';
                emptyEl.style.borderRadius = '4px';
                emptyEl.style.opacity = '0.5';
                emptyEl.style.cursor = waste.length > 0 ? 'pointer' : 'default';
                emptyEl.title = 'Click to recycle waste pile';
                emptyEl.addEventListener('click', () => {
                    if (waste.length === 0) return;
                    stock = waste.map(c => { const nc = Object.assign({}, c); nc.faceUp = false; return nc; }).reverse();
                    waste = [];
                    if (window.appLog) window.appLog('INFO_SOL', 'Recycled waste pile back into stock');
                    render();
                });
                stockDiv.appendChild(emptyEl);
            }
            container.appendChild(stockDiv);

            // Waste pile (top card is selectable / draggable, just like a tableau card)
            const wasteSlot = document.createElement('div');
            wasteSlot.style.position = 'absolute';
            wasteSlot.style.left = (10 + cardW + gap) + 'px';
            wasteSlot.style.top = '10px';
            wasteSlot.style.width = cardW + 'px';
            wasteSlot.style.height = cardH + 'px';
            if (waste.length > 0) {
                const lastWaste = waste[waste.length - 1];
                const wasteEl = document.createElement('div');
                wasteEl.className = 'card ' + lastWaste.color;
                wasteEl.style.width = cardW + 'px';
                wasteEl.style.height = cardH + 'px';
                wasteEl.style.border = isSelected('waste', null, waste.length - 1) ? '2px solid #FFD700' : '1px solid #333';
                wasteEl.style.borderRadius = '4px';
                wasteEl.style.background = '#fff';
                wasteEl.style.display = 'flex';
                wasteEl.style.alignItems = 'center';
                wasteEl.style.justifyContent = 'center';
                wasteEl.style.fontSize = '16px';
                wasteEl.style.fontWeight = 'bold';
                wasteEl.style.color = lastWaste.color;
                wasteEl.style.cursor = 'grab';
                wasteEl.textContent = lastWaste.rank + lastWaste.suit;
                wasteEl.draggable = true;
                wasteEl.addEventListener('dragstart', (e) => {
                    e.dataTransfer.setData('text/plain', makeDragData('waste', null, waste.length - 1));
                });
                wasteEl.addEventListener('click', () => selectCard('waste', null, waste.length - 1, lastWaste));
                wasteEl.addEventListener('dblclick', () => autoSendToFoundation('waste', null, waste.length - 1, lastWaste));
                wasteSlot.appendChild(wasteEl);
            }
            container.appendChild(wasteSlot);

            // Foundation piles
            const foundationOrder = ['♠','♥','♦','♣'];
            for (let i = 0; i < 4; i++) {
                const suit = foundationOrder[i];
                const fDiv = document.createElement('div');
                fDiv.style.position = 'absolute';
                fDiv.style.left = (10 + cardW*3 + gap*3 + i * (cardW + gap)) + 'px';
                fDiv.style.top = '10px';
                fDiv.style.width = cardW + 'px';
                fDiv.style.height = cardH + 'px';
                fDiv.style.border = '2px dashed #fff';
                fDiv.style.borderRadius = '4px';
                fDiv.style.display = 'flex';
                fDiv.style.alignItems = 'center';
                fDiv.style.justifyContent = 'center';
                fDiv.style.fontSize = '24px';
                fDiv.style.color = '#fff';
                fDiv.style.opacity = '0.6';
                fDiv.addEventListener('dragover', (e) => e.preventDefault());
                fDiv.addEventListener('drop', (e) => {
                    e.preventDefault();
                    if (selectFromDragData(e)) onFoundationDropTarget();
                });
                fDiv.addEventListener('click', () => { if (selected) onFoundationDropTarget(); });

                if (foundation[suit].length > 0) {
                    const top = foundation[suit][foundation[suit].length - 1];
                    fDiv.style.border = '1px solid #333';
                    fDiv.style.opacity = '1';
                    fDiv.style.background = '#fff';
                    fDiv.style.color = top.color;
                    fDiv.style.fontSize = '16px';
                    fDiv.style.fontWeight = 'bold';
                    fDiv.textContent = top.rank + top.suit;
                } else {
                    fDiv.textContent = suit;
                }
                container.appendChild(fDiv);
            }

            // Tableau piles
            const tableauTop = 120;
            tableau.forEach((pile, pileIndex) => {
                pile.forEach((card, cardIdx) => {
                    const cardEl = document.createElement('div');
                    cardEl.className = 'card ' + (card.faceUp ? card.color : 'face-down');
                    cardEl.style.position = 'absolute';
                    cardEl.style.left = (10 + pileIndex * (cardW + gap)) + 'px';
                    cardEl.style.top = (tableauTop + cardIdx * overlap) + 'px';
                    cardEl.style.width = cardW + 'px';
                    cardEl.style.height = cardH + 'px';
                    cardEl.style.border = isSelected('tableau', pileIndex, cardIdx) ? '2px solid #FFD700' : '1px solid #333';
                    cardEl.style.borderRadius = '4px';
                    cardEl.style.background = card.faceUp ? '#fff' : '#1A5FB4';
                    cardEl.style.color = card.faceUp ? card.color : '#fff';
                    cardEl.style.display = 'flex';
                    cardEl.style.alignItems = 'center';
                    cardEl.style.justifyContent = 'center';
                    cardEl.style.fontSize = '16px';
                    cardEl.style.fontWeight = 'bold';
                    cardEl.textContent = card.faceUp ? (card.rank + card.suit) : '';
                    if (card.faceUp) {
                        cardEl.style.cursor = 'grab';
                        cardEl.draggable = true;
                        cardEl.addEventListener('dragstart', (e) => {
                            e.dataTransfer.setData('text/plain', makeDragData('tableau', pileIndex, cardIdx));
                        });
                        cardEl.addEventListener('dragover', (e) => e.preventDefault());
                        cardEl.addEventListener('drop', (e) => {
                            e.preventDefault();
                            if (selectFromDragData(e)) onTableauDropTarget(pileIndex);
                        });
                        cardEl.addEventListener('click', () => {
                            // If something is already selected and this card is a valid
                            // landing spot (the top card of a different pile), drop there;
                            // otherwise treat this click as a new selection.
                            if (selected && cardIdx === pile.length - 1 && !(selected.source === 'tableau' && selected.pileIdx === pileIndex)) {
                                onTableauDropTarget(pileIndex);
                            } else {
                                selectCard('tableau', pileIndex, cardIdx, card);
                            }
                        });
                        if (cardIdx === pile.length - 1) {
                            cardEl.addEventListener('dblclick', () => autoSendToFoundation('tableau', pileIndex, cardIdx, card));
                        }
                    }
                    container.appendChild(cardEl);
                });
            });

            // Empty tableau pile placeholders (drop target + click target)
            for (let i = 0; i < tableau.length; i++) {
                if (tableau[i].length === 0) {
                    const placeholder = document.createElement('div');
                    placeholder.style.position = 'absolute';
                    placeholder.style.left = (10 + i * (cardW + gap)) + 'px';
                    placeholder.style.top = tableauTop + 'px';
                    placeholder.style.width = cardW + 'px';
                    placeholder.style.height = cardH + 'px';
                    placeholder.style.border = '2px dashed #fff';
                    placeholder.style.borderRadius = '4px';
                    placeholder.style.opacity = '0.5';
                    placeholder.addEventListener('dragover', (e) => e.preventDefault());
                    placeholder.addEventListener('drop', (e) => {
                        e.preventDefault();
                        if (selectFromDragData(e)) onTableauDropTarget(i);
                    });
                    placeholder.addEventListener('click', () => { if (selected) onTableauDropTarget(i); });
                    container.appendChild(placeholder);
                }
            }

            // Win banner
            if (checkWin()) {
                const winMsg = document.createElement('div');
                winMsg.style.position = 'absolute';
                winMsg.style.top = '50%';
                winMsg.style.left = '50%';
                winMsg.style.transform = 'translate(-50%, -50%)';
                winMsg.style.color = '#FFD700';
                winMsg.style.fontSize = '48px';
                winMsg.style.fontWeight = 'bold';
                winMsg.style.textShadow = '2px 2px 4px rgba(0,0,0,0.6)';
                winMsg.textContent = 'YOU WIN!';
                container.appendChild(winMsg);
            }
        }

        render();
        if (window.appLog) window.appLog('INFO_SOL', 'Solitaire started');
    };
})();
