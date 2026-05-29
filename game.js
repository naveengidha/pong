(() => {
  const canvas = document.getElementById('canvas');
  const ctx = canvas.getContext('2d');
  const overlay = document.getElementById('overlay');
  const startBtn = document.getElementById('start-btn');
  const pauseBtn = document.getElementById('pause-btn');

  // --- Layout: portrait orientation ---
  // Paddles are horizontal bars at top (CPU) and bottom (player)
  // Ball bounces off left/right walls; exits top/bottom to score
  const W = 525;
  const H = 858;
  const PADDLE_W = 80;   // width of paddle (horizontal span)
  const PADDLE_H = 14;   // height of paddle (thickness)
  const BALL_SIZE = 14;
  const PADDLE_SPEED = 5.5;
  const BALL_SPEED_INIT = 5;
  const BALL_SPEED_MAX = 12;
  const BALL_ACCEL = 0.3;
  const WIN_SCORE = 11;
  const SERVE_DELAY = 900;

  // CPU difficulty: how closely the CPU tracks the ball centre (0–1)
  const CPU_TRACKING = 0.06; // per frame fraction — feels human, beatable

  let scale = 1;

  function resize() {
    const maxW = window.innerWidth - 8;
    const maxH = window.innerHeight - 8;
    scale = Math.min(maxW / W, maxH / H);
    canvas.width = W;
    canvas.height = H;
    canvas.style.width = `${W * scale}px`;
    canvas.style.height = `${H * scale}px`;
  }
  resize();
  window.addEventListener('resize', resize);

  // --- Game state ---
  // paddles[0] = CPU (top),  paddles[1] = player (bottom)
  // paddle.x = left edge,  paddle.y = top edge
  const state = {
    phase: 'menu',
    scores: [0, 0], // [cpu, player]
    ball: { x: 0, y: 0, vx: 0, vy: 0, speed: BALL_SPEED_INIT },
    paddles: [
      { x: W / 2 - PADDLE_W / 2, y: 28 },               // CPU top
      { x: W / 2 - PADDLE_W / 2, y: H - 28 - PADDLE_H }, // player bottom
    ],
    serving: false,
    serveTimer: null,
    winner: null,
  };

  // --- Keyboard ---
  const keys = {};
  window.addEventListener('keydown', e => { keys[e.key] = true; });
  window.addEventListener('keyup',   e => { keys[e.key] = false; });

  // --- Touch: drag the player paddle horizontally ---
  let touchStartX = null;
  let paddleStartX = null;

  canvas.addEventListener('touchstart', e => {
    e.preventDefault();
    // Only respond to touches in the bottom third of the canvas
    const rect = canvas.getBoundingClientRect();
    const t = e.changedTouches[0];
    const canvasY = (t.clientY - rect.top) / scale;
    if (canvasY > H * 0.6) {
      touchStartX  = t.clientX;
      paddleStartX = state.paddles[1].x;
    }
  }, { passive: false });

  canvas.addEventListener('touchmove', e => {
    e.preventDefault();
    if (touchStartX === null) return;
    const t = e.changedTouches[0];
    const dx = (t.clientX - touchStartX) / scale;
    state.paddles[1].x = clamp(paddleStartX + dx, 0, W - PADDLE_W);
  }, { passive: false });

  canvas.addEventListener('touchend', e => {
    touchStartX = null;
    paddleStartX = null;
  });

  // --- Helpers ---
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function resetBall(serveToSide) {
    // serveToSide: 0 = toward CPU (up), 1 = toward player (down)
    state.ball.x = W / 2 - BALL_SIZE / 2;
    state.ball.y = H / 2 - BALL_SIZE / 2;
    state.ball.speed = BALL_SPEED_INIT;
    state.serving = true;

    if (state.serveTimer) clearTimeout(state.serveTimer);
    state.serveTimer = setTimeout(() => {
      const angle = (Math.random() * 0.5 - 0.25) * Math.PI; // ±22.5°
      const dir = serveToSide === 0 ? -1 : 1; // negative vy = upward
      state.ball.vx = Math.sin(angle) * state.ball.speed;
      state.ball.vy = dir * Math.cos(angle) * state.ball.speed;
      state.serving = false;
    }, SERVE_DELAY);
  }

  function startGame() {
    state.scores = [0, 0];
    state.paddles[0].x = W / 2 - PADDLE_W / 2;
    state.paddles[1].x = W / 2 - PADDLE_W / 2;
    state.winner = null;
    state.phase = 'playing';
    overlay.classList.add('hidden');
    pauseBtn.classList.add('visible');
    pauseBtn.textContent = '❙❙';
    resetBall(Math.random() < 0.5 ? 0 : 1);
    loop();
  }

  startBtn.addEventListener('click', startGame);
  window.addEventListener('keydown', e => {
    if ((e.key === 'Enter' || e.key === ' ') &&
        (state.phase === 'menu' || state.phase === 'gameover')) {
      startGame();
    }
    if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') {
      togglePause();
    }
  });

  function togglePause() {
    if (state.phase === 'playing') {
      state.phase = 'paused';
      pauseBtn.innerHTML = '&#9654;';
      pauseBtn.setAttribute('aria-label', 'Resume');
    } else if (state.phase === 'paused') {
      state.phase = 'playing';
      pauseBtn.innerHTML = '&#9646;&#9646;';
      pauseBtn.setAttribute('aria-label', 'Pause');
      loop();
    }
  }

  pauseBtn.addEventListener('click', togglePause);

  // --- Update ---
  function update() {
    if (state.phase !== 'playing') return;

    // Player paddle — keyboard (← →) or touch (handled above)
    if (keys['ArrowLeft']  || keys['a'] || keys['A']) state.paddles[1].x -= PADDLE_SPEED;
    if (keys['ArrowRight'] || keys['d'] || keys['D']) state.paddles[1].x += PADDLE_SPEED;
    state.paddles[1].x = clamp(state.paddles[1].x, 0, W - PADDLE_W);

    // CPU paddle — smoothly tracks ball centre, capped to a max speed
    if (!state.serving) {
      const cpu = state.paddles[0];
      const ballCentreX = state.ball.x + BALL_SIZE / 2;
      const paddleCentreX = cpu.x + PADDLE_W / 2;
      const diff = ballCentreX - paddleCentreX;
      // Move a fraction of the gap each frame (smooth, humanlike)
      const move = clamp(diff * CPU_TRACKING, -PADDLE_SPEED, PADDLE_SPEED);
      cpu.x = clamp(cpu.x + move, 0, W - PADDLE_W);
    }

    if (state.serving) return;

    const b = state.ball;
    b.x += b.vx;
    b.y += b.vy;

    // Left / right wall bounce
    if (b.x <= 0) {
      b.x = 0;
      b.vx = Math.abs(b.vx);
    } else if (b.x + BALL_SIZE >= W) {
      b.x = W - BALL_SIZE;
      b.vx = -Math.abs(b.vx);
    }

    // Paddle collisions — top (CPU=0) and bottom (player=1)
    // paddles[0]: ball must be moving upward (vy < 0) to hit it
    // paddles[1]: ball must be moving downward (vy > 0) to hit it
    for (let i = 0; i < 2; i++) {
      const p = state.paddles[i];
      if (
        b.x < p.x + PADDLE_W &&
        b.x + BALL_SIZE > p.x &&
        b.y < p.y + PADDLE_H &&
        b.y + BALL_SIZE > p.y
      ) {
        // Hit position relative to paddle centre (-1 left … +1 right)
        const relX = (b.x + BALL_SIZE / 2 - (p.x + PADDLE_W / 2)) / (PADDLE_W / 2);
        const bounceAngle = relX * (Math.PI / 4); // max ±45°

        b.speed = Math.min(b.speed + BALL_ACCEL, BALL_SPEED_MAX);
        const dir = i === 0 ? 1 : -1; // CPU paddle sends ball downward; player sends it upward
        b.vy = dir * Math.cos(bounceAngle) * b.speed;
        b.vx = Math.sin(bounceAngle) * b.speed;

        // Push ball clear of paddle
        b.y = i === 0 ? p.y + PADDLE_H : p.y - BALL_SIZE;
      }
    }

    // Scoring — ball exits top or bottom
    if (b.y + BALL_SIZE < 0) {
      // Ball passed the CPU's end — player scores
      state.scores[1]++;
      checkWin(1);
    } else if (b.y > H) {
      // Ball passed the player's end — CPU scores
      state.scores[0]++;
      checkWin(0);
    }
  }

  function checkWin(scorer) {
    if (state.scores[scorer] >= WIN_SCORE) {
      state.phase = 'gameover';
      state.winner = scorer;
      showGameOver(scorer);
    } else {
      // Serve toward whoever just lost the point
      resetBall(scorer === 0 ? 1 : 0);
    }
  }

  function showGameOver(winner) {
    pauseBtn.classList.remove('visible');
    overlay.classList.remove('hidden');
    overlay.innerHTML = `
      <h1>${winner === 1 ? 'YOU WIN' : 'CPU WINS'}</h1>
      <p>${state.scores[1]} &ndash; ${state.scores[0]}</p>
      <button id="start-btn">PLAY AGAIN</button>
    `;
    document.getElementById('start-btn').addEventListener('click', startGame);
  }

  // --- Draw ---
  function draw() {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);

    // Centre dashed line (horizontal)
    ctx.setLineDash([14, 14]);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(0,   H / 2);
    ctx.lineTo(W,   H / 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // Scores — CPU score top-centre, player score bottom-centre
    const scoreSize = Math.floor(H * 0.07);
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${scoreSize}px 'Courier New', monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(state.scores[0], W / 2, H * 0.08);        // CPU (top)
    ctx.textBaseline = 'bottom';
    ctx.fillText(state.scores[1], W / 2, H - H * 0.08);    // player (bottom)

    // Paddles (horizontal bars)
    ctx.fillStyle = '#fff';
    for (const p of state.paddles) {
      ctx.fillRect(p.x, p.y, PADDLE_W, PADDLE_H);
    }

    // Ball
    const b = state.ball;
    if (!state.serving) {
      ctx.fillStyle = '#fff';
      ctx.fillRect(b.x, b.y, BALL_SIZE, BALL_SIZE);
    } else if (Math.floor(Date.now() / 250) % 2 === 0) {
      ctx.fillStyle = '#fff';
      ctx.fillRect(b.x, b.y, BALL_SIZE, BALL_SIZE);
    }
  }

  let lastTime = 0;

  function loop(ts = 0) {
    if (state.phase !== 'playing' && state.phase !== 'gameover') return;
    requestAnimationFrame(loop);
    if (ts - lastTime < 14) return;
    lastTime = ts;
    update();
    draw();
  }

  draw();
})();
