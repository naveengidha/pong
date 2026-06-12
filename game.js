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
  const WIN_SCORE = 9;
  const SERVE_DELAY = 900;

  // CPU difficulty: how closely the CPU tracks the ball centre (0–1)
  const CPU_TRACKING = 0.06; // per frame fraction — feels human, beatable

  // --- Themes ---
  const THEMES = {
    classic: {
      bg: '#000', fg: '#fff',
      lineStyle: 'dashed',
      ballShape: 'square',
      paddleStyle: 'flat',
      label: 'CLASSIC',
    },
    hockey: {
      bg: '#ddf0f8', fg: '#1a3a5c',
      lineStyle: 'circle',
      ballShape: 'circle',
      paddleStyle: 'rounded',
      label: 'HOCKEY RINK',
    },
  };
  let activeTheme = 'classic';
  let scale = 1;

  // --- Per-theme mechanics ---
  const THEME_MECHANICS = {
    classic: { paddleW: 80,  cpuTracking: 0.06, cpuBurst: null },
    hockey: {
      paddleW: 110, cpuTracking: 0.03,
      cpuBurst: { triggerDist: 80, burstSpeed: PADDLE_SPEED * 1.6, burstDuration: 12, cooldown: 200 },
    },
  };

  function theme() { return THEMES[activeTheme]; }

  // --- Boost system (hockey only) ---
  const BOOST_KEYS = ['big_stick','sticky_puck','speed_burst','slap_shot','curve','freeze_puck','icing','tiny_stick'];
  const BOOST_LABELS = {
    big_stick:   'BIG STICK',
    sticky_puck: 'STICKY PUCK',
    speed_burst: 'SPEED BURST',
    slap_shot:   'SLAP SHOT',
    curve:       'CURVE SHOT',
    freeze_puck: 'FREEZE PUCK',
    icing:       'ICING!',
    tiny_stick:  'TINY STICK',
  };
  const BOOST_DESC = {
    big_stick:   'YOUR PADDLE IS HUGE',
    sticky_puck: 'PUCK STICKS TO YOUR PADDLE',
    speed_burst: 'YOU MOVE FASTER',
    slap_shot:   'NEXT SHOT FIRES 2× SPEED',
    curve:       'NEXT SHOT GETS HEAVY SPIN',
    freeze_puck: 'PUCK SLOWS DOWN',
    icing:       'OPPONENT PADDLE FROZEN',
    tiny_stick:  'OPPONENT PADDLE SHRINKS',
  };

  function freshBoost() {
    return { paddleWMult: 1, speedMult: 1, frozenFrames: 0, frozenTotal: 0,
             stickyFrames: 0, slapShot: false, curveShot: false,
             bigStickFrames: 0, speedFrames: 0, tinyFrames: 0 };
  }

  window.setTheme = function(key) {
    if (THEMES[key]) { activeTheme = key; draw(); }
  };

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
    ball: { x: 0, y: 0, vx: 0, vy: 0, speed: BALL_SPEED_INIT, spin: 0 },
    paddles: [
      { x: W / 2 - PADDLE_W / 2, y: 28 },               // CPU top
      { x: W / 2 - PADDLE_W / 2, y: H - 28 - PADDLE_H }, // player bottom
    ],
    serving: false,
    serveTimer: null,
    winner: null,
    ai: { paddleW: PADDLE_W, cpuTracking: CPU_TRACKING, burstFramesLeft: 0, burstCooldown: 0 },
    // Boost system
    loot: null,             // { x, y, type, pulse }
    lootSpawnTimer: 0,
    lastTouchedBy: -1,      // 0=CPU, 1=player
    boostAnnounce: null,    // { label, desc, who, framesLeft }
    activeBoosts: [freshBoost(), freshBoost()],
    puckSpeedMult: 1,
    puckFreezeFrames: 0,
    stickyState: null,      // { who, framesLeft }
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
    state.ball.spin = 0;
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
    const mech = THEME_MECHANICS[activeTheme];
    state.scores = [0, 0];
    state.ai.paddleW         = mech.paddleW;
    state.ai.cpuTracking     = mech.cpuTracking;
    state.ai.burstFramesLeft = 0;
    state.ai.burstCooldown   = 0;
    state.paddles[0].x = W / 2 - mech.paddleW / 2;
    state.paddles[1].x = W / 2 - PADDLE_W / 2;
    state.winner = null;
    // Reset boost state
    state.loot            = null;
    state.lootSpawnTimer  = 220;
    state.lastTouchedBy   = -1;
    state.boostAnnounce   = null;
    state.activeBoosts    = [freshBoost(), freshBoost()];
    state.puckSpeedMult   = 1;
    state.puckFreezeFrames = 0;
    state.stickyState     = null;
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

  // --- Theme mechanic helpers ---

  function cpuBurstAI(cpu, ball, ai, cpuXBefore) {
    const burst = THEME_MECHANICS[activeTheme].cpuBurst;
    if (ai.burstCooldown > 0) ai.burstCooldown--;

    const ballNearCpu    = Math.abs(ball.y - cpu.y) < burst.triggerDist;
    const ballHeadingUp  = ball.vy < 0;
    const canBurst       = ai.burstCooldown === 0 && ai.burstFramesLeft === 0;
    const triggerRoll = true;

    if (ballNearCpu && ballHeadingUp && canBurst && triggerRoll) {
      ai.burstFramesLeft = burst.burstDuration;
      ai.burstCooldown   = burst.cooldown;
    }

    if (ai.burstFramesLeft > 0) {
      ai.burstFramesLeft--;
      const ballCX   = ball.x + BALL_SIZE / 2;
      const paddleCX = cpuXBefore + ai.paddleW / 2;
      const move     = clamp(ballCX - paddleCX, -burst.burstSpeed, burst.burstSpeed);
      // Overwrite base tracking — burst replaces it, doesn't stack
      cpu.x = clamp(cpuXBefore + move, 0, W - ai.paddleW);
    }
  }

  // --- Boost / loot helpers ---

  function spawnLoot() {
    const type = BOOST_KEYS[Math.floor(Math.random() * BOOST_KEYS.length)];
    state.loot = {
      x: 60 + Math.random() * (W - 120),
      y: H * 0.2 + Math.random() * (H * 0.6),
      type,
      pulse: 0,
    };
  }

  function collectLoot(who, type) {
    const opp = 1 - who;
    const b   = state.activeBoosts;
    const FPS = 60;
    if (type === 'big_stick')   { b[who].paddleWMult = 1.8;  b[who].bigStickFrames = 8  * FPS; }
    if (type === 'speed_burst') { b[who].speedMult   = 1.8;  b[who].speedFrames    = 6  * FPS; }
    if (type === 'tiny_stick')  { b[opp].paddleWMult = 0.55; b[opp].tinyFrames     = 6  * FPS; }
    if (type === 'icing')       { b[opp].frozenFrames = 2 * FPS; b[opp].frozenTotal = 2 * FPS; }
    if (type === 'sticky_puck') { b[who].stickyFrames = 8  * FPS; }
    if (type === 'slap_shot')   { b[who].slapShot  = true; }
    if (type === 'curve')       { b[who].curveShot = true; }
    if (type === 'freeze_puck') { state.puckSpeedMult = 0.4; state.puckFreezeFrames = 4 * FPS; }

    state.boostAnnounce = {
      label: BOOST_LABELS[type],
      desc:  BOOST_DESC[type],
      who,
      framesLeft: 110,
    };
    state.phase = 'boost_announce';
  }

  // --- Update ---
  function update() {
    // Boost announce phase — just tick down the freeze timer
    if (state.phase === 'boost_announce') {
      state.boostAnnounce.framesLeft--;
      if (state.boostAnnounce.framesLeft <= 0) {
        state.boostAnnounce = null;
        state.phase = 'playing';
      }
      return;
    }

    if (state.phase !== 'playing') return;

    const ai = state.ai;
    const ab = state.activeBoosts;

    // Tick down timed boosts
    if (ab[0].frozenFrames  > 0) ab[0].frozenFrames--;
    if (ab[1].frozenFrames  > 0) ab[1].frozenFrames--;
    if (ab[0].bigStickFrames > 0) { ab[0].bigStickFrames--; if (ab[0].bigStickFrames === 0) ab[0].paddleWMult = 1; }
    if (ab[1].bigStickFrames > 0) { ab[1].bigStickFrames--; if (ab[1].bigStickFrames === 0) ab[1].paddleWMult = 1; }
    if (ab[0].tinyFrames    > 0) { ab[0].tinyFrames--;     if (ab[0].tinyFrames    === 0) ab[0].paddleWMult = 1; }
    if (ab[1].tinyFrames    > 0) { ab[1].tinyFrames--;     if (ab[1].tinyFrames    === 0) ab[1].paddleWMult = 1; }
    if (ab[0].speedFrames   > 0) { ab[0].speedFrames--;    if (ab[0].speedFrames   === 0) ab[0].speedMult   = 1; }
    if (ab[1].speedFrames   > 0) { ab[1].speedFrames--;    if (ab[1].speedFrames   === 0) ab[1].speedMult   = 1; }
    if (state.puckFreezeFrames > 0) { state.puckFreezeFrames--; if (state.puckFreezeFrames === 0) state.puckSpeedMult = 1; }

    // Effective paddle widths including boosts
    const effectivePW = [
      Math.round(ai.paddleW * ab[0].paddleWMult),
      Math.round(PADDLE_W  * ab[1].paddleWMult),
    ];

    // Loot spawn (hockey only)
    if (activeTheme === 'hockey') {
      if (!state.loot) {
        if (state.lootSpawnTimer > 0) state.lootSpawnTimer--;
        else spawnLoot();
      }
    }

    // Sticky state — lock puck to paddle, tick down, then launch
    if (state.stickyState) {
      const ss  = state.stickyState;
      const sp  = state.paddles[ss.who];
      const spw = effectivePW[ss.who];
      state.ball.x = sp.x + spw / 2 - BALL_SIZE / 2;
      state.ball.y = ss.who === 0 ? sp.y + PADDLE_H : sp.y - BALL_SIZE;
      ss.framesLeft--;
      if (ss.framesLeft <= 0) {
        state.stickyState = null;
        // Launch toward opponent
        const dir = ss.who === 0 ? 1 : -1;
        const angle = (Math.random() * 0.4 - 0.2) * Math.PI;
        state.ball.vx = Math.sin(angle) * state.ball.speed;
        state.ball.vy = dir * Math.cos(angle) * state.ball.speed;
      }
      // Still move the paddle normally while holding puck
    }

    // Player paddle
    if (ab[1].frozenFrames === 0) {
      const playerSpeed = PADDLE_SPEED * ab[1].speedMult;
      if (keys['ArrowLeft']  || keys['a'] || keys['A']) state.paddles[1].x -= playerSpeed;
      if (keys['ArrowRight'] || keys['d'] || keys['D']) state.paddles[1].x += playerSpeed;
    }
    state.paddles[1].x = clamp(state.paddles[1].x, 0, W - effectivePW[1]);

    // CPU paddle
    if (!state.serving && ab[0].frozenFrames === 0) {
      const cpu = state.paddles[0];
      const cpuXBefore   = cpu.x;
      const ballCentreX  = state.ball.x + BALL_SIZE / 2;
      const paddleCentreX = cpu.x + effectivePW[0] / 2;
      const diff = ballCentreX - paddleCentreX;
      const move = clamp(diff * ai.cpuTracking, -PADDLE_SPEED, PADDLE_SPEED);
      cpu.x = clamp(cpu.x + move, 0, W - effectivePW[0]);
      if (THEME_MECHANICS[activeTheme].cpuBurst !== null) {
        cpuBurstAI(cpu, state.ball, ai, cpuXBefore);
      }
    }

    if (state.serving || state.stickyState) return;

    const b = state.ball;

    // Apply puck speed multiplier (freeze_puck boost)
    const spd = state.puckSpeedMult;
    b.x += b.vx * spd;
    b.y += b.vy * spd;

    // Wall bounce
    if (b.x <= 0) {
      b.x  = 0;
      b.vx = Math.abs(b.vx);
    } else if (b.x + BALL_SIZE >= W) {
      b.x  = W - BALL_SIZE;
      b.vx = -Math.abs(b.vx);
    }

    // Loot collection
    if (activeTheme === 'hockey' && state.loot) {
      const dx = (b.x + BALL_SIZE / 2) - state.loot.x;
      const dy = (b.y + BALL_SIZE / 2) - state.loot.y;
      if (Math.sqrt(dx * dx + dy * dy) < 22) {
        const collector = state.lastTouchedBy >= 0 ? state.lastTouchedBy : 1;
        collectLoot(collector, state.loot.type);
        state.loot = null;
        state.lootSpawnTimer = 300 + Math.floor(Math.random() * 180);
        return; // phase just changed to boost_announce
      }
    }

    // Paddle collisions
    for (let i = 0; i < 2; i++) {
      const p  = state.paddles[i];
      const pw = effectivePW[i];
      if (
        b.x < p.x + pw &&
        b.x + BALL_SIZE > p.x &&
        b.y < p.y + PADDLE_H &&
        b.y + BALL_SIZE > p.y
      ) {
        state.lastTouchedBy = i;
        const relX        = (b.x + BALL_SIZE / 2 - (p.x + pw / 2)) / (pw / 2);
        const bounceAngle = relX * (Math.PI / 4);
        b.speed = Math.min(b.speed + BALL_ACCEL, BALL_SPEED_MAX);
        const dir = i === 0 ? 1 : -1;

        // Sticky puck — lock to paddle
        if (ab[i].stickyFrames > 0) {
          ab[i].stickyFrames = 0; // consume it
          state.stickyState = { who: i, framesLeft: 120 };
          b.y = i === 0 ? p.y + PADDLE_H : p.y - BALL_SIZE;
          return;
        }

        b.vy  = dir * Math.cos(bounceAngle) * b.speed;
        b.vx  = Math.sin(bounceAngle) * b.speed;
        b.y   = i === 0 ? p.y + PADDLE_H : p.y - BALL_SIZE;
        b.spin = 0;

        // Slap shot — double speed
        if (ab[i].slapShot) {
          b.speed = Math.min(b.speed * 2, BALL_SPEED_MAX * 1.5);
          b.vx *= 2; b.vy *= 2;
          ab[i].slapShot = false;
        }
        // Curve shot — heavy spin
        if (ab[i].curveShot) {
          b.spin = relX * 2.8;
          ab[i].curveShot = false;
        }
      }
    }

    // Scoring
    if (b.y + BALL_SIZE < 0) { state.scores[1]++; checkWin(1); }
    else if (b.y > H)        { state.scores[0]++; checkWin(0); }
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
      <div id="modal">
        <h1>${winner === 1 ? 'YOU WIN' : 'CPU WINS'}</h1>
        <hr />
        <p style="font-size:clamp(1rem,4vw,1.5rem);letter-spacing:0.2em;opacity:0.8">${state.scores[1]} &ndash; ${state.scores[0]}</p>
        <button id="start-btn">PLAY AGAIN</button>
      </div>
    `;
    document.getElementById('start-btn').addEventListener('click', startGame);
  }

  // --- Boost icon renderer ---
  function drawBoostIcon(ctx, key, cx, cy) {
    const fg = '#1a3a5c';
    const S  = 80, r = 26;

    // Glow
    const grad = ctx.createRadialGradient(cx, cy, r * 0.6, cx, cy, r * 1.3);
    grad.addColorStop(0, 'rgba(255,220,50,0.35)');
    grad.addColorStop(1, 'rgba(255,220,50,0)');
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(cx, cy, r * 1.3, 0, Math.PI * 2); ctx.fill();

    // White circle
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = fg;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();

    ctx.fillStyle = fg; ctx.strokeStyle = fg;
    ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.lineJoin = 'round';

    if (key === 'big_stick') {
      const pw = 36, ph = 7;
      ctx.fillRect(cx - pw/2, cy - ph/2, pw, ph);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(cx - pw/2, cy - ph/2 - 4); ctx.lineTo(cx - pw/2, cy + ph/2 + 4);
      ctx.moveTo(cx + pw/2, cy - ph/2 - 4); ctx.lineTo(cx + pw/2, cy + ph/2 + 4);
      ctx.stroke();
    } else if (key === 'sticky_puck') {
      ctx.beginPath(); ctx.arc(cx, cy, 8, 0, Math.PI * 2); ctx.fill();
      ctx.lineWidth = 1.5;
      for (const a of [0, Math.PI * 2/3, Math.PI * 4/3]) {
        const r1 = 10, r2 = 18;
        const x1 = cx + Math.cos(a)*r1, y1 = cy + Math.sin(a)*r1;
        const x2 = cx + Math.cos(a)*r2, y2 = cy + Math.sin(a)*r2;
        const mx = (x1+x2)/2 + Math.cos(a+Math.PI/2)*4;
        const my = (y1+y2)/2 + Math.sin(a+Math.PI/2)*4;
        ctx.beginPath(); ctx.moveTo(x1,y1); ctx.quadraticCurveTo(mx,my,x2,y2); ctx.stroke();
      }
    } else if (key === 'speed_burst') {
      ctx.beginPath();
      ctx.moveTo(cx+4,cy-14); ctx.lineTo(cx-4,cy-2); ctx.lineTo(cx+2,cy-2);
      ctx.lineTo(cx-5,cy+14); ctx.lineTo(cx+6,cy+1); ctx.lineTo(cx-1,cy+1);
      ctx.closePath(); ctx.fill();
    } else if (key === 'slap_shot') {
      ctx.beginPath(); ctx.arc(cx-4, cy, 7, 0, Math.PI*2); ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(cx+4,cy); ctx.lineTo(cx+14,cy); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx+10,cy-4); ctx.lineTo(cx+14,cy); ctx.lineTo(cx+10,cy+4); ctx.stroke();
    } else if (key === 'curve') {
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(cx, cy+4, 12, -Math.PI*0.9, -Math.PI*0.1); ctx.stroke();
      const ea = -Math.PI*0.1;
      const ex = cx + Math.cos(ea)*12, ey = cy+4 + Math.sin(ea)*12;
      const ta = ea + Math.PI/2;
      ctx.beginPath();
      ctx.moveTo(ex+Math.cos(ta-0.5)*6, ey+Math.sin(ta-0.5)*6);
      ctx.lineTo(ex, ey);
      ctx.lineTo(ex+Math.cos(ta+0.5)*6, ey+Math.sin(ta+0.5)*6);
      ctx.stroke();
    } else if (key === 'freeze_puck') {
      ctx.lineWidth = 2;
      for (const a of [0, Math.PI/3, Math.PI*2/3]) {
        ctx.beginPath();
        ctx.moveTo(cx+Math.cos(a)*14, cy+Math.sin(a)*14);
        ctx.lineTo(cx-Math.cos(a)*14, cy-Math.sin(a)*14);
        ctx.stroke();
        for (const s of [1,-1]) {
          const tx = cx+Math.cos(a)*8*s, ty = cy+Math.sin(a)*8*s;
          const pa = a+Math.PI/2;
          ctx.beginPath();
          ctx.moveTo(tx+Math.cos(pa)*4, ty+Math.sin(pa)*4);
          ctx.lineTo(tx-Math.cos(pa)*4, ty-Math.sin(pa)*4);
          ctx.stroke();
        }
      }
      ctx.beginPath(); ctx.arc(cx, cy, 2.5, 0, Math.PI*2); ctx.fill();
    } else if (key === 'icing') {
      const lw = 16, lh = 12;
      ctx.beginPath(); ctx.roundRect(cx-lw/2, cy-1, lw, lh, 3); ctx.fill();
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(cx, cy-1, 5, Math.PI, Math.PI*2); ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(cx, cy+4, 2.5, 0, Math.PI*2); ctx.fill();
    } else if (key === 'tiny_stick') {
      const pw = 18, ph = 6;
      ctx.fillRect(cx-pw/2, cy-ph/2, pw, ph);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(cx-pw/2, cy-ph/2-4); ctx.lineTo(cx-pw/2, cy+ph/2+4);
      ctx.moveTo(cx+pw/2, cy-ph/2-4); ctx.lineTo(cx+pw/2, cy+ph/2+4);
      ctx.stroke();
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(cx, cy-14); ctx.lineTo(cx, cy-ph/2-6); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx-4, cy-ph/2-10); ctx.lineTo(cx, cy-ph/2-6); ctx.lineTo(cx+4, cy-ph/2-10);
      ctx.stroke();
    }
  }

  // --- Draw ---
  function draw() {
    const t = theme();
    ctx.fillStyle = t.bg;
    ctx.fillRect(0, 0, W, H);

    // Theme-specific field markings
    if (activeTheme === 'hockey') {
      ctx.setLineDash([]);

      // NHL rink proportions mapped to canvas (W=525, H=858)
      // Goal lines sit on the paddle center line
      const goalLineTop    = 28 + PADDLE_H / 2;   // center of CPU paddle
      const goalLineBot    = H - 28 - PADDLE_H / 2; // center of player paddle
      // Blue lines: ~31% from each end
      const blueLineTop    = H * 0.31;
      const blueLineBot    = H * 0.69;
      const cx             = W / 2;
      const cy             = H / 2;

      // --- Goal creases (filled light blue semicircle) ---
      const creaseR = 52;
      ctx.fillStyle   = '#aed6f1';
      ctx.globalAlpha = 0.45;
      // Top crease
      ctx.beginPath();
      ctx.arc(cx, goalLineTop, creaseR, 0, Math.PI);
      ctx.fill();
      // Bottom crease
      ctx.beginPath();
      ctx.arc(cx, goalLineBot, creaseR, Math.PI, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;

      // --- Goal lines (red) ---
      ctx.strokeStyle = '#c0392b';
      ctx.lineWidth   = 3;
      ctx.beginPath();
      ctx.moveTo(0, goalLineTop); ctx.lineTo(W, goalLineTop);
      ctx.moveTo(0, goalLineBot); ctx.lineTo(W, goalLineBot);
      ctx.stroke();

      // --- Crease outlines (red) ---
      ctx.beginPath();
      ctx.arc(cx, goalLineTop, creaseR, 0, Math.PI);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, goalLineBot, creaseR, Math.PI, Math.PI * 2);
      ctx.stroke();

      // --- Blue lines ---
      ctx.strokeStyle = '#2471a3';
      ctx.lineWidth   = 6;
      ctx.beginPath();
      ctx.moveTo(0, blueLineTop); ctx.lineTo(W, blueLineTop);
      ctx.moveTo(0, blueLineBot); ctx.lineTo(W, blueLineBot);
      ctx.stroke();

      // --- Center red line (solid) ---
      ctx.strokeStyle = '#c0392b';
      ctx.lineWidth   = 4;
      ctx.beginPath();
      ctx.moveTo(0, cy); ctx.lineTo(W, cy);
      ctx.stroke();

      // --- Center faceoff circle (red) ---
      const bigR = 68;
      ctx.strokeStyle = '#c0392b';
      ctx.lineWidth   = 3;
      ctx.beginPath();
      ctx.arc(cx, cy, bigR, 0, Math.PI * 2);
      ctx.stroke();
      // Center dot
      ctx.fillStyle = '#c0392b';
      ctx.beginPath();
      ctx.arc(cx, cy, 5, 0, Math.PI * 2);
      ctx.fill();

      // --- Zone faceoff circles (red) — two per end zone ---
      const zoneR    = 52;
      const zoneOffX = W * 0.28;   // horizontal offset from center
      // Midpoint between goal line and blue line
      const zoneTopY = (goalLineTop + blueLineTop) / 2;
      const zoneBotY = (goalLineBot + blueLineBot) / 2;

      const faceoffDots = [
        // Top zone (CPU end)
        { x: cx - zoneOffX, y: zoneTopY },
        { x: cx + zoneOffX, y: zoneTopY },
        // Bottom zone (player end)
        { x: cx - zoneOffX, y: zoneBotY },
        { x: cx + zoneOffX, y: zoneBotY },
      ];

      ctx.strokeStyle = '#c0392b';
      ctx.lineWidth   = 2.5;
      for (const dot of faceoffDots) {
        ctx.beginPath();
        ctx.arc(dot.x, dot.y, zoneR, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = '#c0392b';
        ctx.beginPath();
        ctx.arc(dot.x, dot.y, 4, 0, Math.PI * 2);
        ctx.fill();
      }

    } // end hockey markings

    // Centre divider (classic only — hockey draws its own lines above)
    if (activeTheme === 'classic') {
      ctx.strokeStyle = t.fg;
      ctx.lineWidth   = 4;
      ctx.setLineDash([14, 14]);
      ctx.beginPath();
      ctx.moveTo(0, H / 2);
      ctx.lineTo(W, H / 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Scores
    const scoreSize = Math.floor(H * 0.07);
    ctx.fillStyle = t.fg;
    ctx.font = `bold ${scoreSize}px 'Courier New', monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(state.scores[0], W / 2, H * 0.08);
    ctx.textBaseline = 'bottom';
    ctx.fillText(state.scores[1], W / 2, H - H * 0.08);

    // Paddles — use effective widths including boost multipliers
    const drawPW = [
      Math.round(state.ai.paddleW * state.activeBoosts[0].paddleWMult),
      Math.round(PADDLE_W        * state.activeBoosts[1].paddleWMult),
    ];
    ctx.fillStyle = t.fg;
    for (let i = 0; i < state.paddles.length; i++) {
      const p  = state.paddles[i];
      const pw = drawPW[i];
      // Flash frozen paddle
      if (state.activeBoosts[i].frozenFrames > 0) {
        ctx.fillStyle = Math.floor(Date.now() / 120) % 2 === 0 ? '#7fb3d3' : t.fg;
      } else {
        ctx.fillStyle = t.fg;
      }
      if (t.paddleStyle === 'rounded') {
        ctx.beginPath();
        ctx.roundRect(p.x, p.y, pw, PADDLE_H, PADDLE_H / 2);
        ctx.fill();
      } else {
        ctx.fillRect(p.x, p.y, pw, PADDLE_H);
      }
    }

    // Ball
    const b = state.ball;
    const visible = !state.serving || Math.floor(Date.now() / 250) % 2 === 0;
    if (visible) {
      const bx = b.x + BALL_SIZE / 2;
      const by = b.y + BALL_SIZE / 2;
      const br = BALL_SIZE / 2;

      if (activeTheme === 'hockey') {
        // Black rubber puck — flat circle with a subtle highlight
        ctx.fillStyle = '#111';
        ctx.beginPath();
        ctx.arc(bx, by, br, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#444';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(bx, by, br, 0, Math.PI * 2);
        ctx.stroke();

      } else {
        ctx.fillStyle = t.fg;
        if (t.ballShape === 'circle') {
          ctx.beginPath();
          ctx.arc(bx, by, br, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillRect(b.x, b.y, BALL_SIZE, BALL_SIZE);
        }
      }
    }

    // Loot icon (hockey only)
    if (activeTheme === 'hockey' && state.loot) {
      const l = state.loot;
      l.pulse = (l.pulse + 0.07) % (Math.PI * 2);
      ctx.globalAlpha = 0.75 + Math.sin(l.pulse) * 0.25;
      ctx.save();
      drawBoostIcon(ctx, l.type, l.x, l.y);
      ctx.restore();
      ctx.globalAlpha = 1;
    }

    // Active boost HUD — small bar under each score
    if (activeTheme === 'hockey') {
      const ab = state.activeBoosts;
      const hudY0 = H * 0.08 + Math.floor(H * 0.07) + 6;  // below CPU score
      const hudY1 = H - H * 0.08 - Math.floor(H * 0.07) - 18; // above player score
      const hudW  = 60;
      [[0, W/2, hudY0], [1, W/2, hudY1]].forEach(([i, x, y]) => {
        const boost = ab[i];
        const totalF = i === 0
          ? (boost.bigStickFrames || boost.tinyFrames || boost.speedFrames || boost.frozenFrames || 0)
          : (boost.bigStickFrames || boost.tinyFrames || boost.speedFrames || boost.frozenFrames || 0);
        const maxF = boost.bigStickFrames > 0 ? 480 : boost.speedFrames > 0 ? 360 : boost.tinyFrames > 0 ? 360 : boost.frozenFrames > 0 ? boost.frozenTotal : 0;
        if (maxF > 0 && totalF > 0) {
          const frac = totalF / maxF;
          ctx.fillStyle = 'rgba(255,255,255,0.15)';
          ctx.fillRect(x - hudW/2, y, hudW, 4);
          ctx.fillStyle = '#f0c040';
          ctx.fillRect(x - hudW/2, y, hudW * frac, 4);
        }
        // One-shot indicators
        if (boost.slapShot || boost.curveShot || boost.stickyFrames > 0) {
          ctx.fillStyle = '#f0c040';
          ctx.font = `bold 11px 'Courier New', monospace`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';
          const label = boost.slapShot ? '⚡' : boost.curveShot ? '↺' : '●';
          ctx.fillText(label, x, y);
        }
      });
    }

    // Boost announce overlay
    if (state.boostAnnounce) {
      const ann    = state.boostAnnounce;
      const fadeIn = ann.framesLeft > 80 ? (110 - ann.framesLeft) / 30 : 1;
      const fadeOut = ann.framesLeft < 30 ? ann.framesLeft / 30 : 1;
      const alpha  = Math.min(fadeIn, fadeOut);

      ctx.globalAlpha = alpha * 0.72;
      ctx.fillStyle   = '#000';
      ctx.fillRect(0, H / 2 - 70, W, 140);
      ctx.globalAlpha = alpha;

      const whoLabel = ann.who === 1 ? 'YOU GOT IT' : 'CPU GOT IT';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#f0c040';
      ctx.font = `bold 13px 'Courier New', monospace`;
      ctx.textBaseline = 'middle';
      ctx.fillText(whoLabel, W / 2, H / 2 - 38);

      ctx.fillStyle = '#fff';
      ctx.font = `bold 32px 'Courier New', monospace`;
      ctx.fillText(ann.label, W / 2, H / 2);

      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.font = `12px 'Courier New', monospace`;
      ctx.fillText(ann.desc, W / 2, H / 2 + 34);

      ctx.globalAlpha = 1;
    }
  }

  let lastTime = 0;

  function loop(ts = 0) {
    if (state.phase !== 'playing' && state.phase !== 'gameover' && state.phase !== 'boost_announce') return;
    requestAnimationFrame(loop);
    if (ts - lastTime < 14) return;
    lastTime = ts;
    update();
    draw();
  }

  draw();
})();
