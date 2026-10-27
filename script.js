'use strict';

// ===== 기본 설정 =====
const W = 180, H = 320;          // 캔버스 논리 해상도 (CSS로 확대, pixelated)
const GROUND_Y = 280;            // 땅 윗면
const BIRD_X = 52;
const BIRD_R = 6;                // 충돌 반지름
const GRAVITY = 1100;
const FLAP_V = -290;
const MAX_FALL = 420;
const SPEED = 75;                // 파이프·땅 스크롤 속도 (px/s)
const PIPE_W = 30, CAP_W = 34, CAP_H = 12;
const GAP = 82;                  // 위아래 파이프 사이 틈
const PIPE_SPACING = 105;        // 파이프 사이 가로 간격
const STEP = 1 / 120;            // 고정 물리 스텝
const BEST_KEY = 'flappy-best';

const COLORS = {
  K: '#2b2b33', Y: '#f8d838', W: '#ffffff', R: '#f05030', O: '#f0a030', y: '#e0b020',
};

const $ = id => document.getElementById(id);
const canvas = $('board');
const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = false;

const ui = {
  stage: $('stage'), status: $('status'), statusText: $('statusText'),
  score: $('score'), best: $('best'), pauseBtn: $('pauseBtn'),
  overlay: $('overlay'), startPanel: $('startPanel'), pausePanel: $('pausePanel'), overPanel: $('overPanel'),
  startBest: $('startBest'), overReason: $('overReason'), overScore: $('overScore'), overBest: $('overBest'),
  overRecord: $('overRecord'), medal: $('medal'),
};

function loadBest() { try { return Number(localStorage.getItem(BEST_KEY)) || 0; } catch { return 0; } }
function saveBest() { try { localStorage.setItem(BEST_KEY, String(best)); } catch { /* 저장 불가 */ } }

// ===== 픽셀 스프라이트 =====
const BIRD_BODY = [
  '......KKKKKK.....',
  '....KKYYYKWWK....',
  '...KYYYYKWWWWK...',
  '..KYYYYYKWWWKWK..',
  '.KYYYYYYKWWWKWK..',
  '.KYYYYYYYKWWWWK..',
  '.KyYYYYYYYKKKKKK.',
  '.KyyYYYYYKRRRRRRK',
  '..KyyYYYKRKKKKKK.',
  '...KOOOOOKRRRRRK.',
  '....KKOOOOOKKKKK.',
  '......KKKKK......',
];
const WING = [
  '.KKKK.',
  'KWWWWK',
  'KYWWWK',
  '.KKKK.',
];
const WING_Y = [2, 4, 6];        // 날개 위/가운데/아래

function paint(g, rows, ox, oy) {
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const c = COLORS[row[x]];
      if (c) { g.fillStyle = c; g.fillRect(ox + x, oy + y, 1, 1); }
    }
  });
}

function makeCanvas(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  draw(g);
  return c;
}

const birdFrames = WING_Y.map(wy => makeCanvas(17, 12, g => {
  paint(g, BIRD_BODY, 0, 0);
  paint(g, WING, 0, wy);
}));

// 간단한 시드 난수 (배경이 매번 같게)
function seeded(seed) {
  return () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
}

// 배경 레이어: 가로 W 픽셀짜리 타일을 반복해서 그림
const cloudLayer = makeCanvas(W, 60, g => {
  g.fillStyle = '#ffffff';
  const r = seeded(7);
  for (let x = -10; x < W + 10; x += 14) {
    const h = 14 + Math.floor(r() * 18);
    g.fillRect(x, 60 - h, 18, h);
    g.fillRect(x + 4, 60 - h - 4, 10, 4);
  }
});
const cityLayer = makeCanvas(W, 50, g => {
  const r = seeded(42);
  for (let x = 0; x < W; ) {
    const bw = 10 + Math.floor(r() * 12);
    const bh = 18 + Math.floor(r() * 30);
    g.fillStyle = '#a8e0c0';
    g.fillRect(x, 50 - bh, bw, bh);
    g.fillStyle = '#d8f4e4';
    for (let wy = 50 - bh + 3; wy < 46; wy += 5)
      for (let wx = x + 2; wx < x + bw - 2; wx += 4) g.fillRect(wx, wy, 2, 2);
    x += bw + 1;
  }
});
const bushLayer = makeCanvas(W, 18, g => {
  const r = seeded(99);
  for (let x = -6; x < W + 6; x += 9) {
    const h = 8 + Math.floor(r() * 9);
    g.fillStyle = '#5ec84a';
    g.fillRect(x, 18 - h, 14, h);
    g.fillStyle = '#80dc6a';
    g.fillRect(x + 2, 18 - h, 6, 2);
  }
});
const groundTile = makeCanvas(12, H - GROUND_Y, g => {
  g.fillStyle = COLORS.K; g.fillRect(0, 0, 12, 1);
  g.fillStyle = '#9ce659'; g.fillRect(0, 1, 12, 6);
  g.fillStyle = '#73bf2e';
  for (let i = 0; i < 6; i++) g.fillRect(i * 2 - 6 + 6, 1 + i, 6, 1); // 사선 줄무늬
  g.fillStyle = '#558022'; g.fillRect(0, 7, 12, 1);
  g.fillStyle = '#ded895'; g.fillRect(0, 8, 12, H - GROUND_Y - 8);
  g.fillStyle = '#d0c874'; g.fillRect(3, 16, 2, 1); g.fillRect(9, 26, 2, 1);
});

function tile(img, offset, y) {
  const x = -(offset % img.width);
  for (let i = x; i < W; i += img.width) ctx.drawImage(img, Math.floor(i), y);
}

// ===== 게임 상태 =====
let state = 'ready';     // ready | playing | paused | over
let best = loadBest();
let score = 0;
let bird, pipes, scroll, time, flash, overTimer, overShown, deathReason, newRecord;

function reset() {
  bird = { y: 150, vy: 0, angle: 0, frame: 0, flapT: 0 };
  pipes = [];
  scroll = 0;
  time = 0;
  flash = 0;
  overTimer = 0;
  overShown = false;
  newRecord = false;
  score = 0;
  updateHud();
}

function setState(s) {
  state = s;
  const labels = { ready: '준비', playing: '비행 중', paused: '일시정지', over: '게임 오버' };
  ui.status.className = 'status ' + s;
  ui.statusText.textContent = labels[s];
  ui.pauseBtn.disabled = !(s === 'playing' || s === 'paused');
  ui.pauseBtn.textContent = s === 'paused' ? '▶' : 'Ⅱ';
  ui.pauseBtn.setAttribute('aria-label', s === 'paused' ? '계속하기' : '일시정지');
}

function showPanel(panel) {
  [ui.startPanel, ui.pausePanel, ui.overPanel].forEach(p => p.classList.toggle('hidden', p !== panel));
  ui.overlay.classList.toggle('hidden', !panel);
}

function updateHud() {
  ui.score.textContent = score;
  ui.best.textContent = best;
  ui.startBest.textContent = best;
}

function spawnPipe(x) {
  const margin = 40;
  const min = margin + GAP / 2, max = GROUND_Y - margin - GAP / 2;
  pipes.push({ x, gapY: Math.round(min + Math.random() * (max - min)), passed: false });
}

function start() {
  reset();
  spawnPipe(W + 40);
  showPanel(null);
  setState('playing');
  flap();
}

function flap() {
  bird.vy = FLAP_V;
  bird.flapT = 0.25;
}

function pause() {
  if (state !== 'playing') return;
  setState('paused');
  showPanel(ui.pausePanel);
}

function resume() {
  if (state !== 'paused') return;
  setState('playing');
  showPanel(null);
}

function retry() {
  reset();
  setState('ready');
  showPanel(null);      // 다시하기는 시작 화면 없이 바로 '준비' 상태로
}

function gameOver(reason) {
  deathReason = reason;
  flash = 1;
  if (score > best) { best = score; newRecord = true; saveBest(); }
  updateHud();
  setState('over');
}

function showResult() {
  overShown = true;
  ui.overReason.textContent = deathReason;
  ui.overScore.textContent = score;
  ui.overBest.textContent = best;
  ui.overRecord.classList.toggle('hidden', !newRecord);
  const medal = score >= 40 ? 'gold' : score >= 20 ? 'silver' : score >= 10 ? 'bronze' : 'none';
  ui.medal.className = 'medal ' + medal;
  ui.medal.title = { gold: '금메달', silver: '은메달', bronze: '동메달', none: '메달 없음' }[medal];
  showPanel(ui.overPanel);
}

// ===== 입력 =====
function press() {
  if (state === 'ready') {
    if (!ui.startPanel.classList.contains('hidden')) showPanel(null);
    start();
  } else if (state === 'playing') {
    flap();
  } else if (state === 'paused') {
    resume();
  }
  // 게임 오버 중 화면 탭은 무시 (실수로 바로 재시작되지 않도록) — 다시하기 버튼/키로만
}

function confirmKey() {
  if (state === 'over') { if (overShown) retry(); }
  else press();
}

ui.stage.addEventListener('pointerdown', e => {
  if (e.target.closest('button')) return;
  e.preventDefault();
  press();
});

document.addEventListener('keydown', e => {
  if (e.repeat) return;
  switch (e.code) {
    case 'Space': case 'ArrowUp': case 'KeyW': case 'Enter': case 'NumpadEnter':
      e.preventDefault();
      confirmKey();
      break;
    case 'KeyP': case 'Escape':
      e.preventDefault();
      if (state === 'playing') pause(); else if (state === 'paused') resume();
      break;
  }
});

function onButton(btn, fn) {
  btn.addEventListener('click', e => { e.stopPropagation(); btn.blur(); fn(); });
}
onButton($('startBtn'), start);
onButton($('resumeBtn'), resume);
onButton($('retryBtn'), retry);
onButton(ui.pauseBtn, () => (state === 'paused' ? resume() : pause()));

document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });

// ===== 물리 =====
function hitsRect(cx, cy, r, x, y, w, h) {
  const nx = Math.max(x, Math.min(cx, x + w));
  const ny = Math.max(y, Math.min(cy, y + h));
  return (cx - nx) ** 2 + (cy - ny) ** 2 < r * r;
}

function update(dt) {
  time += dt;
  flash = Math.max(0, flash - dt * 3);

  if (state === 'ready') {
    scroll += SPEED * dt;
    bird.y = 150 + Math.sin(time * 5) * 4;
    bird.angle = 0;
    bird.frame = Math.floor(time * 8) % 3;
    return;
  }

  if (state === 'over') {
    // 부딪힌 뒤 새가 땅까지 떨어지고, 잠시 후 결과창
    if (bird.y + BIRD_R < GROUND_Y) {
      bird.vy = Math.min(bird.vy + GRAVITY * dt, MAX_FALL);
      bird.y = Math.min(bird.y + bird.vy * dt, GROUND_Y - BIRD_R);
      bird.angle = Math.min(bird.angle + dt * 8, Math.PI / 2);
    }
    overTimer += dt;
    if (!overShown && overTimer > 0.7) showResult();
    return;
  }

  // playing
  scroll += SPEED * dt;
  bird.vy = Math.min(bird.vy + GRAVITY * dt, MAX_FALL);
  bird.y += bird.vy * dt;
  bird.flapT = Math.max(0, bird.flapT - dt);
  bird.angle = Math.max(-0.45, Math.min(1.4, bird.vy / 330));
  bird.frame = bird.vy > 200 ? 1 : Math.floor(time * 14) % 3;

  for (const p of pipes) p.x -= SPEED * dt;
  if (pipes.length && pipes[0].x + CAP_W < 0) pipes.shift();
  const last = pipes[pipes.length - 1];
  if (last && last.x < W - PIPE_SPACING) spawnPipe(last.x + PIPE_SPACING);

  // 점수: 파이프 중앙을 지나면 1점
  for (const p of pipes) {
    if (!p.passed && p.x + PIPE_W / 2 < BIRD_X) {
      p.passed = true;
      score++;
      updateHud();
    }
  }

  // 충돌
  if (bird.y - BIRD_R <= 0) { bird.y = BIRD_R; bird.vy = 0; return gameOver('천장에 부딪혔어요'); }
  if (bird.y + BIRD_R >= GROUND_Y) { bird.y = GROUND_Y - BIRD_R; return gameOver('땅에 떨어졌어요'); }
  for (const p of pipes) {
    const top = p.gapY - GAP / 2, bottom = p.gapY + GAP / 2;
    const cx = p.x - (CAP_W - PIPE_W) / 2;
    if (hitsRect(BIRD_X, bird.y, BIRD_R, p.x, 0, PIPE_W, top - CAP_H) ||
        hitsRect(BIRD_X, bird.y, BIRD_R, cx, top - CAP_H, CAP_W, CAP_H) ||
        hitsRect(BIRD_X, bird.y, BIRD_R, cx, bottom, CAP_W, CAP_H) ||
        hitsRect(BIRD_X, bird.y, BIRD_R, p.x, bottom + CAP_H, PIPE_W, GROUND_Y - bottom - CAP_H)) {
      if (bird.vy < 0) bird.vy = 0;
      return gameOver('파이프에 부딪혔어요');
    }
  }
}

// ===== 그리기 =====
function drawPipeBody(x, y, h) {
  if (h <= 0) return;
  ctx.fillStyle = COLORS.K; ctx.fillRect(x, y, PIPE_W, h);
  ctx.fillStyle = '#74bf2e'; ctx.fillRect(x + 1, y, PIPE_W - 2, h);
  ctx.fillStyle = '#9ce659'; ctx.fillRect(x + 3, y, 4, h);
  ctx.fillStyle = '#c8f08a'; ctx.fillRect(x + 4, y, 1, h);
  ctx.fillStyle = '#558022'; ctx.fillRect(x + PIPE_W - 6, y, 4, h);
}

function drawPipeCap(x, y) {
  ctx.fillStyle = COLORS.K; ctx.fillRect(x, y, CAP_W, CAP_H);
  ctx.fillStyle = '#74bf2e'; ctx.fillRect(x + 1, y + 1, CAP_W - 2, CAP_H - 2);
  ctx.fillStyle = '#9ce659'; ctx.fillRect(x + 3, y + 1, 5, CAP_H - 2);
  ctx.fillStyle = '#558022'; ctx.fillRect(x + CAP_W - 7, y + 1, 5, CAP_H - 2);
}

function drawPipes() {
  for (const p of pipes) {
    const x = Math.round(p.x);
    const cx = x - (CAP_W - PIPE_W) / 2;
    const top = p.gapY - GAP / 2, bottom = p.gapY + GAP / 2;
    drawPipeBody(x, 0, top - CAP_H);
    drawPipeCap(cx, top - CAP_H);
    drawPipeBody(x, bottom + CAP_H, GROUND_Y - bottom - CAP_H);
    drawPipeCap(cx, bottom);
  }
}

function drawBird() {
  ctx.save();
  ctx.translate(BIRD_X, Math.round(bird.y));
  ctx.rotate(bird.angle);
  ctx.drawImage(birdFrames[bird.frame], -9, -6);
  ctx.restore();
}

function outlinedText(text, x, y, size, color) {
  ctx.font = `${size}px Silkscreen, monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillStyle = COLORS.K;
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [1, 1], [0, 2], [1, 2]]) ctx.fillText(text, x + dx, y + dy);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

function draw() {
  ctx.fillStyle = '#4ec0ca';
  ctx.fillRect(0, 0, W, H);
  tile(cloudLayer, scroll * 0.1, GROUND_Y - 100);
  tile(cityLayer, scroll * 0.25, GROUND_Y - 68);
  tile(bushLayer, scroll * 0.5, GROUND_Y - 18);

  drawPipes();
  tile(groundTile, scroll, GROUND_Y);
  drawBird();

  if (state === 'ready' && ui.startPanel.classList.contains('hidden')) {
    outlinedText('GET READY', W / 2, 70, 16, '#f8b030');
    outlinedText('TAP / SPACE', W / 2, 196, 8, '#ffffff');
    // 탭 안내 화살표
    const bob = Math.floor(time * 4) % 2;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(BIRD_X - 1, 166 + bob, 3, 8);
    ctx.fillRect(BIRD_X - 3, 168 + bob, 7, 2);
  }
  if (state === 'playing' || state === 'paused' || (state === 'over' && !overShown)) {
    outlinedText(String(score), W / 2, 18, 20, '#ffffff');
  }
  if (flash > 0) {
    ctx.fillStyle = `rgba(255,255,255,${flash * 0.8})`;
    ctx.fillRect(0, 0, W, H);
  }
}

// ===== 루프 =====
let lastT = performance.now(), acc = 0;
function loop(now) {
  acc += Math.min(0.1, (now - lastT) / 1000);
  lastT = now;
  if (state !== 'paused') {
    while (acc >= STEP) { update(STEP); acc -= STEP; }
  } else {
    acc = 0;
  }
  draw();
  requestAnimationFrame(loop);
}

reset();
setState('ready');
showPanel(ui.startPanel);
requestAnimationFrame(loop);
