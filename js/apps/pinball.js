// Pinball app - a 2D physics pinball table (Space-Cadet-ish: flippers, bumpers,
// a chargeable plunger lane, drain, score, 3 balls per game). Runs entirely
// client-side on a <canvas>, no server/network/storage involved at all.
window.initPinball = function(container, winId) {
    const W = 400, H = 620;

    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex; flex-direction:column; align-items:center; height:100%; background:#111; font-family:Tahoma, sans-serif; color:#0f0; box-sizing:border-box; padding:4px; gap:4px;';
    wrap.innerHTML = `
        <div style="width:${W}px; display:flex; justify-content:space-between; align-items:center; font-size:13px; padding:2px 4px;">
            <span class="pb-score">SCORE: 0</span>
            <span class="pb-balls">BALL 1/3</span>
            <button class="pb-newgame" style="font-size:11px; background:#333; color:#0f0; border:1px solid #0f0; border-radius:3px; padding:3px 8px;">New game</button>
        </div>
        <canvas class="pb-canvas" width="${W}" height="${H}" style="background:#000; border:2px solid #555; touch-action:none;"></canvas>
        <div style="display:flex; justify-content:space-between; width:${W}px; gap:6px;">
            <button class="pb-left-btn" style="flex:1; padding:10px 0; font-size:13px; background:#333; color:#0f0; border:2px solid #0f0; border-radius:4px;">◀ FLIP</button>
            <button class="pb-launch-btn" style="flex:1; padding:10px 0; font-size:13px; background:#333; color:#0f0; border:2px solid #0f0; border-radius:4px;">↑ LAUNCH</button>
            <button class="pb-right-btn" style="flex:1; padding:10px 0; font-size:13px; background:#333; color:#0f0; border:2px solid #0f0; border-radius:4px;">FLIP ▶</button>
        </div>
        <div style="font-size:10px; opacity:0.6;">Tastiera: ← → per i flipper, barra spazio per il plunger</div>
    `;
    container.appendChild(wrap);

    const canvas = wrap.querySelector('.pb-canvas');
    const ctx = canvas.getContext('2d');
    const scoreEl = wrap.querySelector('.pb-score');
    const ballsEl = wrap.querySelector('.pb-balls');
    const newGameBtn = wrap.querySelector('.pb-newgame');
    const leftBtn = wrap.querySelector('.pb-left-btn');
    const rightBtn = wrap.querySelector('.pb-right-btn');
    const launchBtn = wrap.querySelector('.pb-launch-btn');

    // ---- table geometry ----------------------------------------------
    const LANE_X = 365; // vertical plunger lane sits to the right of the main field
    const walls = [
        { x1: 20, y1: 580, x2: 20, y2: 60 },
        { x1: 20, y1: 60, x2: 60, y2: 20 },
        { x1: 60, y1: 20, x2: 335, y2: 20 },
        { x1: 335, y1: 20, x2: 355, y2: 60 },
        { x1: 355, y1: 60, x2: 355, y2: 580 },
        { x1: 355, y1: 580, x2: 235, y2: 580 }, // right outlane floor
        { x1: 145, y1: 580, x2: 20, y2: 580 }   // left outlane floor
        // gap between x=145 and x=235 at y=580 is the drain, guarded by the flippers
    ];

    const bumpers = [
        { x: 130, y: 190, r: 18, flash: 0 },
        { x: 270, y: 190, r: 18, flash: 0 },
        { x: 200, y: 125, r: 20, flash: 0 }
    ];

    const flippers = {
        left: { pivotX: 150, pivotY: 560, len: 68, restAngle: 0.55, activeAngle: -0.55, angle: 0.55, prevAngle: 0.55, pressed: false },
        right: { pivotX: 235, pivotY: 560, len: 68, restAngle: Math.PI - 0.55, activeAngle: Math.PI + 0.55, angle: Math.PI - 0.55, prevAngle: Math.PI - 0.55, pressed: false }
    };
    flippers.left.angle = flippers.left.restAngle;
    flippers.right.angle = flippers.right.restAngle;

    const GRAVITY = 0.32;
    const RESTITUTION = 0.72;
    const FLIPPER_TURN_SPEED = 0.35; // radians per frame towards target

    let ball = null;
    let score = 0;
    let ballsLeft = 3;
    let gameOver = false;
    let inLane = true;
    let launchCharge = 0;
    let charging = false;

    function resetBall() {
        ball = { x: LANE_X, y: 560, vx: 0, vy: 0, radius: 8 };
        inLane = true;
        launchCharge = 0;
    }
    resetBall();

    function beep(freq, dur) {
        try {
            const AC = window.AudioContext || window.webkitAudioContext;
            if (!AC) return;
            if (!wrap._audioCtx) wrap._audioCtx = new AC();
            const ac = wrap._audioCtx;
            const osc = ac.createOscillator();
            const gain = ac.createGain();
            osc.frequency.value = freq;
            osc.connect(gain);
            gain.connect(ac.destination);
            gain.gain.setValueAtTime(0.06, ac.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + dur);
            osc.start();
            osc.stop(ac.currentTime + dur);
        } catch (e) { /* audio not available - not essential to gameplay */ }
    }

    function addScore(n) {
        score += n;
        scoreEl.textContent = 'SCORE: ' + score;
    }

    function closestPointOnSegment(px, py, x1, y1, x2, y2) {
        const dx = x2 - x1, dy = y2 - y1;
        const lenSq = dx * dx + dy * dy;
        let t = lenSq === 0 ? 0 : ((px - x1) * dx + (py - y1) * dy) / lenSq;
        t = Math.max(0, Math.min(1, t));
        return { x: x1 + t * dx, y: y1 + t * dy };
    }

    function resolveCircleVsSegment(cx, cy, radius, x1, y1, x2, y2, extraRadius) {
        const cp = closestPointOnSegment(cx, cy, x1, y1, x2, y2);
        const dx = cx - cp.x, dy = cy - cp.y;
        const dist = Math.hypot(dx, dy);
        const minDist = radius + (extraRadius || 0);
        if (dist < minDist && dist > 0.0001) {
            return { hit: true, nx: dx / dist, ny: dy / dist, penetration: minDist - dist, cp };
        }
        return { hit: false };
    }

    function updateFlipper(f) {
        f.prevAngle = f.angle;
        const target = f.pressed ? f.activeAngle : f.restAngle;
        const diff = target - f.angle;
        const step = Math.sign(diff) * Math.min(Math.abs(diff), FLIPPER_TURN_SPEED);
        f.angle += step;
    }

    function flipperTip(f) {
        return { x: f.pivotX + Math.cos(f.angle) * f.len, y: f.pivotY + Math.sin(f.angle) * f.len };
    }

    function handleFlipperCollision(f) {
        const tip = flipperTip(f);
        const res = resolveCircleVsSegment(ball.x, ball.y, ball.radius, f.pivotX, f.pivotY, tip.x, tip.y, 9);
        if (!res.hit) return;
        ball.x += res.nx * res.penetration;
        ball.y += res.ny * res.penetration;
        const dot = ball.vx * res.nx + ball.vy * res.ny;
        ball.vx -= (1 + RESTITUTION) * dot * res.nx;
        ball.vy -= (1 + RESTITUTION) * dot * res.ny;
        // Extra kick from the flipper's own angular motion (the "flip" impulse) -
        // approximate the tip's linear speed and push the ball along with it.
        const angularVel = f.angle - f.prevAngle;
        if (Math.abs(angularVel) > 0.02) {
            const distFromPivot = Math.hypot(res.cp.x - f.pivotX, res.cp.y - f.pivotY);
            const tangentX = -Math.sin(f.angle), tangentY = Math.cos(f.angle);
            const kick = angularVel * distFromPivot * 0.9;
            ball.vx += tangentX * kick;
            ball.vy += tangentY * kick;
        }
    }

    function step() {
        // -- flippers --
        updateFlipper(flippers.left);
        updateFlipper(flippers.right);

        if (inLane) {
            if (charging) {
                launchCharge = Math.min(launchCharge + 0.9, 26);
                ball.y = Math.max(560 - launchCharge * 1.2, 300);
            }
            ctx.save();
            draw();
            ctx.restore();
            return;
        }

        // -- ball physics --
        ball.vy += GRAVITY;
        ball.vx *= 0.999;
        ball.vy *= 0.999;
        const speed = Math.hypot(ball.vx, ball.vy);
        const MAX_SPEED = 16;
        if (speed > MAX_SPEED) { ball.vx = ball.vx / speed * MAX_SPEED; ball.vy = ball.vy / speed * MAX_SPEED; }
        ball.x += ball.vx;
        ball.y += ball.vy;

        // -- walls --
        walls.forEach(w => {
            const res = resolveCircleVsSegment(ball.x, ball.y, ball.radius, w.x1, w.y1, w.x2, w.y2, 0);
            if (res.hit) {
                ball.x += res.nx * res.penetration;
                ball.y += res.ny * res.penetration;
                const dot = ball.vx * res.nx + ball.vy * res.ny;
                ball.vx -= (1 + RESTITUTION) * dot * res.nx;
                ball.vy -= (1 + RESTITUTION) * dot * res.ny;
            }
        });

        // -- bumpers --
        bumpers.forEach(b => {
            const dx = ball.x - b.x, dy = ball.y - b.y;
            const dist = Math.hypot(dx, dy);
            if (dist < ball.radius + b.r && dist > 0.0001) {
                const nx = dx / dist, ny = dy / dist;
                ball.x = b.x + nx * (ball.radius + b.r);
                ball.y = b.y + ny * (ball.radius + b.r);
                const dot = ball.vx * nx + ball.vy * ny;
                const bounce = 6.5;
                ball.vx = nx * bounce;
                ball.vy = ny * bounce;
                b.flash = 8;
                addScore(10);
                beep(440, 0.08);
            }
        });

        // -- flippers collision --
        handleFlipperCollision(flippers.left);
        handleFlipperCollision(flippers.right);

        // -- drain: fell through the gap at the bottom between the flippers --
        if (ball.y > 600) {
            ballsLeft--;
            ballsEl.textContent = 'BALL ' + (4 - ballsLeft) + '/3';
            if (ballsLeft <= 0) {
                gameOver = true;
            } else {
                resetBall();
            }
        }

        draw();
    }

    function draw() {
        ctx.clearRect(0, 0, W, H);
        ctx.strokeStyle = '#888';
        ctx.lineWidth = 3;
        ctx.beginPath();
        walls.forEach(w => { ctx.moveTo(w.x1, w.y1); ctx.lineTo(w.x2, w.y2); });
        ctx.stroke();

        // launch lane guide
        ctx.strokeStyle = '#444';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(355, 20); ctx.lineTo(355, 580);
        ctx.stroke();

        bumpers.forEach(b => {
            ctx.beginPath();
            ctx.fillStyle = b.flash > 0 ? '#ffee00' : '#e00';
            ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
            ctx.fill();
            if (b.flash > 0) b.flash--;
        });

        [flippers.left, flippers.right].forEach(f => {
            const tip = flipperTip(f);
            ctx.strokeStyle = '#0af';
            ctx.lineWidth = 14;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(f.pivotX, f.pivotY);
            ctx.lineTo(tip.x, tip.y);
            ctx.stroke();
        });

        if (inLane && charging) {
            ctx.fillStyle = '#0f0';
            ctx.fillRect(378, 580 - launchCharge * 1.2, 8, launchCharge * 1.2);
        }

        ctx.beginPath();
        ctx.fillStyle = '#eee';
        ctx.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2);
        ctx.fill();

        if (gameOver) {
            ctx.fillStyle = 'rgba(0,0,0,0.75)';
            ctx.fillRect(0, H / 2 - 40, W, 80);
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 22px Tahoma, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('GAME OVER — ' + score + ' punti', W / 2, H / 2 + 8);
            ctx.textAlign = 'left';
        }
    }

    function launch() {
        if (!inLane) return;
        charging = false;
        // Instead of expecting the ball to physically climb the launch
        // corridor against gravity (which got it stuck jittering against
        // the right-hand wall instead of ever reaching the top opening),
        // place it directly at the corridor's opening into the main field
        // and give it a leftward/upward push from there - far more reliable.
        ball.x = 340;
        ball.y = 45;
        ball.vx = -3 - Math.random() * 1.2;
        ball.vy = -3 - launchCharge * 0.28; // more charge = shoots further in before gravity arcs it back down
        inLane = false;
    }

    function newGame() {
        score = 0;
        ballsLeft = 3;
        gameOver = false;
        scoreEl.textContent = 'SCORE: 0';
        ballsEl.textContent = 'BALL 1/3';
        resetBall();
    }

    newGameBtn.addEventListener('click', newGame);

    // ---- input: keyboard (desktop) ----
    function onKeyDown(e) {
        if (e.key === 'ArrowLeft') { flippers.left.pressed = true; e.preventDefault(); }
        else if (e.key === 'ArrowRight') { flippers.right.pressed = true; e.preventDefault(); }
        else if (e.key === ' ') {
            e.preventDefault();
            if (gameOver) { newGame(); return; }
            if (inLane) charging = true;
        }
    }
    function onKeyUp(e) {
        if (e.key === 'ArrowLeft') flippers.left.pressed = false;
        else if (e.key === 'ArrowRight') flippers.right.pressed = false;
        else if (e.key === ' ') { if (charging) launch(); }
    }
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);

    // ---- input: on-screen buttons (mouse + touch via pointer events) ----
    function bindHold(btn, onDown, onUp) {
        btn.addEventListener('pointerdown', (e) => { e.preventDefault(); onDown(); });
        btn.addEventListener('pointerup', onUp);
        btn.addEventListener('pointerleave', onUp);
        btn.addEventListener('pointercancel', onUp);
    }
    bindHold(leftBtn, () => { flippers.left.pressed = true; }, () => { flippers.left.pressed = false; });
    bindHold(rightBtn, () => { flippers.right.pressed = true; }, () => { flippers.right.pressed = false; });
    bindHold(launchBtn, () => { if (gameOver) { newGame(); return; } if (inLane) charging = true; }, () => { if (charging) launch(); });

    // ---- main loop ----
    let running = true;
    let rafId = null;
    function loop() {
        if (!running) return;
        if (!gameOver) step(); else draw();
        rafId = requestAnimationFrame(loop);
    }
    loop();

    if (window.WindowManager && typeof WindowManager.registerCleanup === 'function') {
        WindowManager.registerCleanup(winId, () => {
            running = false;
            if (rafId) cancelAnimationFrame(rafId);
            document.removeEventListener('keydown', onKeyDown);
            document.removeEventListener('keyup', onKeyUp);
            if (wrap._audioCtx) wrap._audioCtx.close().catch(() => {});
        });
    }
};
