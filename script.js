// ═══════════════════════════════════════════════════════
//  OPERATOR / PERSISTENT SESSION DATA
// ═══════════════════════════════════════════════════════
let operator = { first: '', last: '', callsign: '' };
let sessionGames = [];   // array of game result objects, persists across retries
let currentGameNum = 0;  // 1-indexed

// ═══════════════════════════════════════════════════════
//  LOGIN
// ═══════════════════════════════════════════════════════
document.getElementById('loginBtn').addEventListener('click', submitLogin);
document.addEventListener('keydown', e => {
  if (document.getElementById('loginScreen').style.display !== 'none' &&
    document.getElementById('loginScreen').style.display !== '') return;
  if (e.code === 'Space' && gameActive) {
    e.preventDefault();
    triggerFire();
  }
});
// Allow Enter key on login fields
['inputFirst', 'inputLast', 'inputCallsign'].forEach(id => {
  document.getElementById(id).addEventListener('keydown', e => {
    if (e.key === 'Enter') submitLogin();
  });
});

function submitLogin() {
  const first = document.getElementById('inputFirst').value.trim();
  const last = document.getElementById('inputLast').value.trim().toUpperCase();
  const callsign = document.getElementById('inputCallsign').value.trim().toUpperCase();
  const err = document.getElementById('loginError');

  if (!first) { err.textContent = '⚠ FIRST NAME REQUIRED'; return; }
  if (!last) { err.textContent = '⚠ LAST INITIAL REQUIRED'; return; }
  if (!callsign) { err.textContent = '⚠ CALL SIGN REQUIRED'; return; }

  operator = { first, last, callsign };
  err.textContent = '';

  // Hide login, show cred accepted
  document.getElementById('loginScreen').style.display = 'none';
  showCredAccepted();
}

function showCredAccepted() {
  const ca = document.getElementById('credAccepted');
  ca.style.display = 'flex';
  document.getElementById('credName').textContent =
    `${operator.first.toUpperCase()} ${operator.last}  ·  CALL SIGN: "${operator.callsign}"`;

  // Rebuild cred bar animation (re-trigger)
  const fill = ca.querySelector('.cred-bar-fill');
  fill.style.animation = 'none';
  void fill.offsetWidth;
  fill.style.animation = 'credLoad 2s linear forwards';

  // Update header
  document.getElementById('operatorTag').textContent =
    `OPERATOR: ${operator.first.toUpperCase()} ${operator.last}  |  "${operator.callsign}"`;

  setTimeout(() => {
    ca.style.display = 'none';
    currentGameNum++;
    startGame();
  }, 2400);
}

// ═══════════════════════════════════════════════════════
//  CANVAS + CONSTANTS
// ═══════════════════════════════════════════════════════
const canvas = document.getElementById('radarCanvas');
const ctx = canvas.getContext('2d');
const W = canvas.width, H = canvas.height;
const CX = W / 2, CY = H / 2;

// ═══════════════════════════════════════════════════════
//  GAME CONFIGURATION (TWEAK THESE VALUES TO ADJUST GAME BALANCE)
// ═══════════════════════════════════════════════════════
const APP_CONFIG = {
  // --- Difficulty & Timing ---
  // How fast the turret swivels into position. Higher = faster.
  TURRET_SPEED: 0.048,

  // Radar sweep animation speed (radians per frame)
  RADAR_SWEEP_SPEED: 0.010,

  // Base time to aim before enemy emerges (ms). Reduced by scale per wave down to min.
  WARNING_BASE_MS: 4800,
  WARNING_SCALE_MS: 320,
  WARNING_MIN_MS: 1800,

  // Time enemy sits before firing on base (ms). Reduced by scale per wave.
  ENEMY_FIRE_BASE_MS: 800,
  ENEMY_FIRE_SCALE_MS: 80,
  ENEMY_FIRE_MIN_MS: 400,

  // --- Scoring & Tolerances ---
  HIT_TOLERANCE_DIRECT: 0.4, // How close a shot needs to be for a direct hit (grid units)
  HIT_TOLERANCE: 0.8,        // How close for a normal hit

  SCORE_DIRECT_HIT: 120,
  SCORE_HIT: 100,
  STREAK_BONUS: 5,
  KILLS_PER_WAVE: 5,
  DEBUG: true
};

const MAX_R = 5;
const UNIT = (W / 2 - 32) / MAX_R;
const TURRET_SPEED = APP_CONFIG.TURRET_SPEED;

// ═══════════════════════════════════════════════════════
//  GAME STATE
// ═══════════════════════════════════════════════════════
let score = 0, streak = 0, totalShots = 0, totalHits = 0, totalDirectHits = 0;
let kills = 0, wave = 1, maxWave = 1;
let hp = 5, gameActive = false;
let currentTarget = null;
let playerClick = null;
let particles = [], friendlyProjectiles = [], enemyProjectiles = [];
let radarAngle = 0, animId = null;

// Per-engagement shot log for the report
let engagementLog = [];  // [{coord, result, error, timeS, wave}]

let turretAngle = 0;
let turretTarget = null;
let turretTurning = false;

let phase = 'idle';
let warningTickId = null, enemyFireId = null;
let spawnTime = null;
let enemy = null;

// ═══════════════════════════════════════════════════════
//  DIFFICULTY
// ═══════════════════════════════════════════════════════
function getAngles() {
  if (wave <= 2) return [0, 30, 45, 60, 90, 120, 135, 150, 180, 210, 225, 240, 270, 300, 315, 330];
  if (wave <= 4) { const a = []; for (let i = 0; i < 360; i += 15) a.push(i); return a; }
  if (wave === 5) { const a = []; for (let i = 0; i < 360; i += 3) a.push(i); return a; }
  if (wave <= 7) return [0, 30, 45, 60, 90, 120, 135, 150, 180, 210, 225, 240, 270, 300, 315, 330];
  if (wave <= 9) { const a = []; for (let i = 0; i < 360; i += 15) a.push(i); return a; }
  const a = []; for (let i = 0; i < 360; i += 20) a.push(i); return a;
}
function getWarningMs() { 
  let bonus = (wave >= 6) ? 3000 : 0;
  return Math.max(APP_CONFIG.WARNING_MIN_MS, APP_CONFIG.WARNING_BASE_MS + bonus - wave * APP_CONFIG.WARNING_SCALE_MS); 
}
function getEnemyFireMs() { return Math.max(APP_CONFIG.ENEMY_FIRE_MIN_MS, APP_CONFIG.ENEMY_FIRE_BASE_MS - wave * APP_CONFIG.ENEMY_FIRE_SCALE_MS); }

// ═══════════════════════════════════════════════════════
//  COORDINATE UTIL
// ═══════════════════════════════════════════════════════
function polarToCanvas(r, deg) {
  const rad = deg * Math.PI / 180;
  return { x: CX + r * UNIT * Math.cos(rad), y: CY - r * UNIT * Math.sin(rad) };
}

// ═══════════════════════════════════════════════════════
//  GAME FLOW
// ═══════════════════════════════════════════════════════
function degreeToRadianStr(deg) {
  if (deg === 0) return "0";
  const gcd = (a, b) => b === 0 ? a : gcd(b, a % b);
  const d = gcd(deg, 180);
  const num = deg / d;
  const den = 180 / d;
  let res = "";
  if (num === 1) res = "π";
  else res = num + "π";
  if (den !== 1) res += "/" + den;
  return res;
}

function newTarget() {
  phase = 'warning';
  playerClick = null; turretTarget = null; turretTurning = false;
  enemy = null; friendlyProjectiles = []; enemyProjectiles = [];

  const rVals = [1, 2, 3, 4, 5];
  const angles = getAngles();
  const r = rVals[Math.floor(Math.random() * rVals.length)];
  const theta = angles[Math.floor(Math.random() * angles.length)];
  const pos = polarToCanvas(r, theta);
  
  let thetaStr = `${theta}°`;
  if (wave >= 6) {
    thetaStr = degreeToRadianStr(theta);
  }
  
  currentTarget = { r, theta, thetaStr, x: pos.x, y: pos.y };

  document.getElementById('coordDisplay').textContent = `( ${r} , ${thetaStr} )`;
  document.getElementById('fireBtn').disabled = true;
  document.getElementById('fireBtn').className = '';
  setResult('— PLOT & AIM BEFORE EMERGENCE —', 'r-wait');
  document.getElementById('hintText').innerHTML =
    `Threat at <b style="color:var(--red)">(${r}, ${thetaStr})</b> — click to aim while you still can!`;

  startWarningBar();
}

function startWarningBar() {
  const dur = getWarningMs();
  let rem = dur;
  clearInterval(warningTickId);
  warningTickId = setInterval(() => {
    if (!gameActive) { clearInterval(warningTickId); return; }
    rem -= 40;
    const f = rem / dur;
    const bar = document.getElementById('timerBar');
    bar.style.width = (f * 100) + '%';
    const col = f > 0.55 ? 'var(--green)' : f > 0.25 ? 'var(--orange)' : 'var(--red)';
    bar.style.background = col;
    bar.style.boxShadow = `0 0 10px ${col}`;
    if (rem <= 0) { clearInterval(warningTickId); enemyEmerge(); }
  }, 40);
}

function enemyEmerge() {
  if (!gameActive) return;
  phase = 'emerged';
  spawnTime = Date.now();
  enemy = { x: currentTarget.x, y: currentTarget.y, rot: Math.random() * Math.PI * 2, alive: true };

  clearInterval(enemyFireId);
  enemyFireId = setInterval(() => {
    if (!gameActive || !enemy || !enemy.alive) return;
    launchEnemyShot();
  }, getEnemyFireMs());
}

function launchEnemyShot() {
  const ex = enemy.x, ey = enemy.y;
  const tx = CX + (Math.random() - 0.5) * 25, ty = CY + (Math.random() - 0.5) * 25;
  const steps = 24; let step = 0;
  const p = { x: ex, y: ey };
  enemyProjectiles.push(p);
  const id = setInterval(() => {
    p.x = ex + (tx - ex) * (step / steps); p.y = ey + (ty - ey) * (step / steps); step++;
    if (step > steps) {
      clearInterval(id);
      const i = enemyProjectiles.indexOf(p);
      if (i !== -1) enemyProjectiles.splice(i, 1);
      if (gameActive && enemy && enemy.alive) { damageShield(1); shakeScreen(); if (hp <= 0) gameOver(); }
    }
  }, 15);
}

// ═══════════════════════════════════════════════════════
//  INPUT
// ═══════════════════════════════════════════════════════
canvas.addEventListener('click', e => {
  if (!gameActive || !currentTarget || phase === 'resolving' || phase === 'idle') return;
  const rect = canvas.getBoundingClientRect();
  const sx = W / rect.width, sy = H / rect.height;
  playerClick = { x: (e.clientX - rect.left) * sx, y: (e.clientY - rect.top) * sy };
  turretTarget = Math.atan2(playerClick.y - CY, playerClick.x - CX);
  document.getElementById('fireBtn').disabled = false;
  document.getElementById('fireBtn').className = 'ready';
  setResult('— TARGET LOCKED — FIRE! —', 'r-wait blink');
});

document.getElementById('fireBtn').addEventListener('click', triggerFire);

document.addEventListener('keydown', e => {
  if (e.code === 'Space') {
    e.preventDefault();
    if (gameActive) triggerFire();
  }
});

function triggerFire() {
  if (!gameActive || !playerClick || turretTurning) return;
  if (phase === 'resolving' || phase === 'idle') return;
  document.getElementById('fireBtn').disabled = true;
  document.getElementById('fireBtn').className = '';
  turretTurning = true;
  setResult('— TURRET ROTATING... —', 'r-wait');
}

// ═══════════════════════════════════════════════════════
//  FIRE RESOLUTION
// ═══════════════════════════════════════════════════════
function executeFire() {
  turretTurning = false;
  if (!gameActive || !playerClick || !currentTarget) return;
  totalShots++;
  const elapsed = spawnTime ? (Date.now() - spawnTime) / 1000 : 999;

  launchFriendlyProjectile(CX, CY, playerClick.x, playerClick.y, () => {
    const dx = playerClick.x - currentTarget.x, dy = playerClick.y - currentTarget.y;
    const err = Math.sqrt(dx * dx + dy * dy) / UNIT;
    const isDirect = err < APP_CONFIG.HIT_TOLERANCE_DIRECT, isHit = err < APP_CONFIG.HIT_TOLERANCE;

    if (isHit) {
      clearEnemyTimers();
      if (enemy) {
        spawnParticles(enemy.x, enemy.y, '#ff3344', 30); spawnParticles(enemy.x, enemy.y, '#ff8800', 16);
        if (isDirect) spawnParticles(enemy.x, enemy.y, '#ffdd00', 20); enemy = null;
      } else {
        spawnParticles(currentTarget.x, currentTarget.y, '#00eeff', 40); 
        spawnParticles(currentTarget.x, currentTarget.y, '#ffffff', 20);
        if (isDirect) spawnParticles(currentTarget.x, currentTarget.y, '#ffdd00', 20);
      }

      totalHits++; kills++; streak++;
      if (isDirect) totalDirectHits++;
      if (wave > maxWave) maxWave = wave;

      const timeBonus = Math.max(0, Math.round((isDirect ? 10 : 6) - elapsed) * (isDirect ? 25 : 12));
      const pts = (isDirect ? APP_CONFIG.SCORE_DIRECT_HIT : APP_CONFIG.SCORE_HIT) + timeBonus + streak * APP_CONFIG.STREAK_BONUS;
      score += pts;

      let resultStr = '';
      if (!enemy && phase === 'warning') {
          resultStr = isDirect ? 'PRE-EMPTIVE DIRECT' : 'PRE-EMPTIVE STRIKE';
      } else {
          resultStr = isDirect ? 'DIRECT HIT' : 'HIT';
      }
      
      const tStr = currentTarget.thetaStr || `${currentTarget.theta}°`;
      engagementLog.push({ coord: `(${currentTarget.r}, ${tStr})`, result: resultStr, error: err.toFixed(2), timeS: elapsed.toFixed(1), wave, pts });

      if (isDirect) {
        setResult(resultStr.includes('PRE-') ? `⚡ ${resultStr}! +${pts} pts` : `⭐ ${resultStr}!  +${pts} pts`, 'r-direct');
        addLog(`<span class="log-direct">${resultStr.includes('PRE-') ? '⚡' : '⭐'} ${resultStr} (${currentTarget.r}, ${tStr}) err:${err.toFixed(2)} t:${elapsed.toFixed(1)}s +${pts}pts</span>`);
      } else {
        setResult(resultStr.includes('PRE-') ? `⚡ ${resultStr}! +${pts} pts (err ${err.toFixed(2)})` : `✓ ${resultStr}!  +${pts} pts  (err ${err.toFixed(2)})`, 'r-hit');
        addLog(`<span class="log-hit">${resultStr.includes('PRE-') ? '⚡' : '✓'} ${resultStr} (${currentTarget.r}, ${tStr}) err:${err.toFixed(2)} t:${elapsed.toFixed(1)}s +${pts}pts</span>`);
      }

      phase = 'resolving'; updateStats();
      let shouldAdvance = false;
      if (APP_CONFIG.DEBUG && wave <= 5) {
        if (kills === wave) shouldAdvance = true;
      } else {
        if (kills > 0 && kills % APP_CONFIG.KILLS_PER_WAVE === 0) shouldAdvance = true;
      }

      if (shouldAdvance) { wave++; showWaveAnnounce(); }
      setTimeout(() => { if (gameActive) advanceRound(); }, 900);

    } else {
      spawnParticles(playerClick.x, playerClick.y, '#886600', 10);
      const tStr = currentTarget.thetaStr || `${currentTarget.theta}°`;
      setResult(`✗ MISS — off by ${err.toFixed(2)} units — RE-AIM!`, 'r-miss');
      addLog(`<span class="log-miss">✗ MISS (${currentTarget.r}, ${tStr}) err:${err.toFixed(2)}</span>`);
      engagementLog.push({ coord: `(${currentTarget.r}, ${tStr})`, result: 'MISS', error: err.toFixed(2), timeS: elapsed.toFixed(1), wave, pts: 0 });
      streak = 0; playerClick = null;
      document.getElementById('fireBtn').disabled = true;
      document.getElementById('fireBtn').className = '';
      updateStats();
    }
  });
}

function launchFriendlyProjectile(x1, y1, x2, y2, onDone) {
  const steps = 22; let step = 0;
  const p = { x: x1, y: y1, px: x1, py: y1 };
  friendlyProjectiles.push(p);
  const id = setInterval(() => {
    p.px = p.x; p.py = p.y;
    p.x = x1 + (x2 - x1) * (step / steps); p.y = y1 + (y2 - y1) * (step / steps); step++;
    if (step > steps) { clearInterval(id); const i = friendlyProjectiles.indexOf(p); if (i !== -1) friendlyProjectiles.splice(i, 1); onDone(); }
  }, 13);
}

// ═══════════════════════════════════════════════════════
//  DRAW LOOP
// ═══════════════════════════════════════════════════════
function gameLoop() {
  drawRadarBg(); drawEnemy(); drawPlayerAim();
  drawProjectiles(); drawParticles(); drawTurret();
  animId = requestAnimationFrame(gameLoop);
}

function drawRadarBg() {
  ctx.clearRect(0, 0, W, H);
  const bg = ctx.createRadialGradient(CX, CY, 0, CX, CY, W / 2);
  bg.addColorStop(0, '#021a0e'); bg.addColorStop(1, '#020d08');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

  for (let r = 1; r <= MAX_R; r++) {
    ctx.beginPath(); ctx.arc(CX, CY, r * UNIT, 0, Math.PI * 2);
    ctx.strokeStyle = r === MAX_R ? 'rgba(0,200,100,0.55)' : 'rgba(0,170,80,0.28)';
    ctx.lineWidth = r === MAX_R ? 1.5 : 1; ctx.stroke();
    ctx.fillStyle = 'rgba(0,180,80,0.65)';
    ctx.font = '11px Share Tech Mono'; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    ctx.fillText(r, CX + r * UNIT + 3, CY - 3);
  }

  const majors = new Set([0, 30, 45, 60, 90, 120, 135, 150, 180, 210, 225, 240, 270, 300, 315, 330]);
  const axes = new Set([0, 90, 180, 270]);
  for (let deg = 0; deg < 360; deg += 15) {
    const rad = deg * Math.PI / 180, isAxis = axes.has(deg), isMajor = majors.has(deg);
    const len = MAX_R * UNIT + (isAxis ? 22 : isMajor ? 14 : 6);
    ctx.beginPath(); ctx.moveTo(CX, CY);
    ctx.lineTo(CX + len * Math.cos(rad), CY - len * Math.sin(rad));
    ctx.strokeStyle = isAxis ? 'rgba(0,200,100,0.5)' : isMajor ? 'rgba(0,170,80,0.3)' : 'rgba(0,120,50,0.13)';
    ctx.lineWidth = isAxis ? 1.5 : 1; ctx.stroke();
    if (isMajor || isAxis) {
      const lr = MAX_R * UNIT + 22;
      ctx.fillStyle = isAxis ? 'rgba(0,255,136,0.85)' : 'rgba(0,200,100,0.65)';
      ctx.font = `${isAxis ? 'bold ' : ''} 10px Share Tech Mono`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(deg + '°', CX + lr * Math.cos(rad), CY - lr * Math.sin(rad));
    }
  }

  radarAngle = (radarAngle + APP_CONFIG.RADAR_SWEEP_SPEED) % (Math.PI * 2);
  ctx.save(); ctx.translate(CX, CY); ctx.rotate(-radarAngle);
  const sg = ctx.createLinearGradient(0, 0, MAX_R * UNIT, 0);
  sg.addColorStop(0, 'rgba(0,255,136,0.28)'); sg.addColorStop(1, 'rgba(0,255,136,0)');
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, MAX_R * UNIT, -0.55, 0, false);
  ctx.closePath(); ctx.fillStyle = sg; ctx.fill(); ctx.restore();
}

function drawEnemy() {
  if (!enemy || !enemy.alive) return;
  enemy.rot += 0.028;
  const pulse = 0.82 + 0.18 * Math.sin(Date.now() * 0.006);
  ctx.save(); ctx.translate(enemy.x, enemy.y); ctx.rotate(enemy.rot);
  ctx.beginPath(); ctx.arc(0, 0, 26 * pulse, 0, Math.PI * 2);
  ctx.strokeStyle = `rgba(255,51,68,${0.15 + 0.15 * pulse})`; ctx.lineWidth = 2; ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0, -13 * pulse); ctx.lineTo(10 * pulse, 0);
  ctx.lineTo(0, 10 * pulse); ctx.lineTo(-10 * pulse, 0); ctx.closePath();
  ctx.fillStyle = 'rgba(255,40,55,0.9)'; ctx.strokeStyle = '#ff8888'; ctx.lineWidth = 1.5;
  ctx.shadowBlur = 25; ctx.shadowColor = '#ff3344'; ctx.fill(); ctx.stroke(); ctx.shadowBlur = 0;
  ctx.beginPath(); ctx.arc(0, 0, 4, 0, Math.PI * 2);
  ctx.fillStyle = '#ffbbbb'; ctx.shadowBlur = 10; ctx.shadowColor = '#ff3344';
  ctx.fill(); ctx.shadowBlur = 0; ctx.restore();
}

function drawPlayerAim() {
  if (!playerClick || turretTurning || phase === 'resolving') return;
  const { x, y } = playerClick;
  ctx.save(); ctx.strokeStyle = 'rgba(255,200,0,0.8)'; ctx.lineWidth = 1.5;
  ctx.shadowBlur = 8; ctx.shadowColor = '#ffdd00';
  ctx.beginPath(); ctx.moveTo(x - 16, y); ctx.lineTo(x + 16, y); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x, y - 16); ctx.lineTo(x, y + 16); ctx.stroke();
  ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2); ctx.stroke();
  ctx.shadowBlur = 0; ctx.restore();
}

function drawProjectiles() {
  friendlyProjectiles.forEach(p => {
    ctx.save(); ctx.beginPath(); ctx.arc(p.x, p.y, 4.5, 0, Math.PI * 2);
    ctx.fillStyle = '#00ff88'; ctx.shadowBlur = 20; ctx.shadowColor = '#00ff88'; ctx.fill();
    ctx.beginPath(); ctx.arc(p.px || p.x, p.py || p.y, 2, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,255,136,0.28)'; ctx.shadowBlur = 0; ctx.fill(); ctx.restore();
  });
  enemyProjectiles.forEach(p => {
    ctx.save(); ctx.beginPath(); ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = '#ff3344'; ctx.shadowBlur = 16; ctx.shadowColor = '#ff3344';
    ctx.fill(); ctx.shadowBlur = 0; ctx.restore();
  });
}

function drawParticles() {
  particles = particles.filter(p => p.life > 0);
  particles.forEach(p => {
    p.x += p.vx; p.y += p.vy; p.vy += 0.09; p.life--;
    ctx.save(); ctx.globalAlpha = p.life / p.maxLife;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fillStyle = p.color; ctx.shadowBlur = 8; ctx.shadowColor = p.color;
    ctx.fill(); ctx.shadowBlur = 0; ctx.restore();
  });
}

function drawTurret() {
  if (turretTurning && turretTarget !== null) {
    let diff = turretTarget - turretAngle;
    while (diff > Math.PI) diff -= Math.PI * 2; while (diff < -Math.PI) diff += Math.PI * 2;
    if (Math.abs(diff) < TURRET_SPEED + 0.002) { turretAngle = turretTarget; executeFire(); }
    else turretAngle += Math.sign(diff) * TURRET_SPEED;
  } else if (!turretTurning && playerClick && phase !== 'idle') {
    const aa = Math.atan2(playerClick.y - CY, playerClick.x - CX);
    let diff = aa - turretAngle;
    while (diff > Math.PI) diff -= Math.PI * 2; while (diff < -Math.PI) diff += Math.PI * 2;
    turretAngle += diff * 0.04;
  }

  ctx.save(); ctx.translate(CX, CY);
  ctx.beginPath(); ctx.arc(0, 0, 11, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,200,100,0.35)'; ctx.strokeStyle = '#00ff88'; ctx.lineWidth = 1.5;
  ctx.shadowBlur = 18; ctx.shadowColor = '#00ff88'; ctx.fill(); ctx.stroke(); ctx.shadowBlur = 0;
  ctx.rotate(turretAngle);
  ctx.strokeStyle = turretTurning ? '#ffdd00' : '#00ff88'; ctx.lineWidth = 4;
  ctx.shadowBlur = turretTurning ? 18 : 10; ctx.shadowColor = turretTurning ? '#ffdd00' : '#00ff88';
  ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(5, 0); ctx.lineTo(34, 0); ctx.stroke();
  ctx.shadowBlur = 0; ctx.restore();

  const deg = Math.round(((-(turretAngle * 180 / Math.PI)) % 360 + 360) % 360);
  document.getElementById('turretAngleDisplay').textContent =
    turretTurning ? `ROTATING → ${deg}°` : `TURRET: ${deg}°`;
}

// ═══════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════
function spawnParticles(x, y, color, n) {
  for (let i = 0; i < n; i++) particles.push({
    x, y,
    vx: (Math.random() - 0.5) * 7, vy: (Math.random() - 0.5) * 7,
    size: Math.random() * 4 + 1, life: 40 + Math.random() * 35, maxLife: 75, color
  });
}

function damageShield(amt) {
  hp = Math.max(0, hp - amt);
  for (let i = 1; i <= 5; i++) {
    const pip = document.getElementById('hp' + i);
    if (i <= hp) { pip.classList.add('flash'); setTimeout(() => pip.classList.remove('flash'), 350); }
  }
  updateHP();
}

function updateHP() {
  for (let i = 1; i <= 5; i++) document.getElementById('hp' + i).classList.toggle('dead', i > hp);
}

function shakeScreen() {
  canvas.classList.remove('shaking'); void canvas.offsetWidth;
  canvas.classList.add('shaking'); setTimeout(() => canvas.classList.remove('shaking'), 320);
}

function clearEnemyTimers() {
  clearInterval(warningTickId); clearInterval(enemyFireId);
  document.getElementById('timerBar').style.width = '0%';
  enemyProjectiles = [];
}

function advanceRound() {
  phase = 'idle'; currentTarget = null; playerClick = null;
  turretTarget = null; turretTurning = false;
  friendlyProjectiles = []; enemyProjectiles = []; enemy = null;
  document.getElementById('fireBtn').disabled = true;
  document.getElementById('fireBtn').className = '';
  newTarget();
}

function showWaveAnnounce() {
  const el = document.getElementById('waveAnnounce');
  el.textContent = `WAVE ${wave} — THREAT ESCALATING`;
  el.style.opacity = '1'; setTimeout(() => el.style.opacity = '0', 2200);
  document.getElementById('waveDisplay').textContent = wave;
}

function setResult(msg, cls) {
  const el = document.getElementById('resultMsg'); el.textContent = msg; el.className = cls;
}

function addLog(html) {
  const log = document.getElementById('killLog');
  log.innerHTML = html + '<br>' + log.innerHTML;
  const lines = log.innerHTML.split('<br>');
  if (lines.length > 14) log.innerHTML = lines.slice(0, 14).join('<br>');
}

function updateStats() {
  document.getElementById('scoreDisplay').textContent = score;
  document.getElementById('streakDisplay').textContent = streak;
  const acc = totalShots > 0 ? Math.round((totalHits / totalShots) * 100) : 0;
  document.getElementById('accDisplay').textContent = acc + '%';
  document.getElementById('waveDisplay').textContent = wave;
}

// ═══════════════════════════════════════════════════════
//  GAME OVER
// ═══════════════════════════════════════════════════════
function gameOver() {
  gameActive = false; clearEnemyTimers(); enemy = null; phase = 'idle';
  const acc = totalShots > 0 ? Math.round((totalHits / totalShots) * 100) : 0;
  sessionGames.push({
    gameNum: currentGameNum,
    score, kills, totalShots, totalHits, totalDirectHits,
    wave, acc,
    log: [...engagementLog]
  });
  document.getElementById('gameCounter').textContent = `ENGAGEMENT ${currentGameNum} OF SESSION`;
  document.getElementById('finalScore').textContent = score + ' pts';
  document.getElementById('overlayStats').innerHTML =
    `Shots fired: <b style="color:var(--green)">${totalShots}</b> &nbsp;
     Kills: <b style="color:var(--green)">${kills}</b> &nbsp;
     Direct hits: <b style="color:var(--yellow)">${totalDirectHits}</b> &nbsp;
     Accuracy: <b style="color:var(--green)">${acc}%</b><br>
     Max wave reached: <b style="color:var(--cyan)">${wave}</b>`;
  document.getElementById('overlay').style.display = 'flex';
}

// ═══════════════════════════════════════════════════════
//  AFTER ACTION REPORT
// ═══════════════════════════════════════════════════════
document.getElementById('reportBtn').addEventListener('click', downloadReport);

function downloadReport() {
  const now = new Date();
  const timestamp = now.toLocaleString();
  const pad = (s, n) => String(s).padEnd(n);
  const rpad = (s, n) => String(s).padStart(n);
  let lines = [];
  lines.push('╔══════════════════════════════════════════════════════════════════╗');
  lines.push('║         UNIFIED POLAR DEFENSE COMMAND — AFTER ACTION REPORT     ║');
  lines.push('╚══════════════════════════════════════════════════════════════════╝');
  lines.push('');
  lines.push(`  OPERATOR : ${operator.first.toUpperCase()} ${operator.last}`);
  lines.push(`  CALL SIGN: ${operator.callsign}`);
  lines.push(`  GENERATED: ${timestamp}`);
  lines.push(`  TOTAL ENGAGEMENTS THIS SESSION: ${sessionGames.length}`);
  lines.push('');
  lines.push('══════════════════════════════════════════════════════════════════');
  sessionGames.forEach(g => {
    const acc = g.totalShots > 0 ? Math.round((g.totalHits / g.totalShots) * 100) : 0;
    const directPct = g.totalHits > 0 ? Math.round((g.totalDirectHits / g.totalHits) * 100) : 0;
    lines.push('');
    lines.push(`  ┌─ ENGAGEMENT ${g.gameNum} ${'─'.repeat(50)}`);
    lines.push(`  │  Score         : ${g.score} pts`);
    lines.push(`  │  Kills         : ${g.kills}`);
    lines.push(`  │  Shots Fired   : ${g.totalShots}`);
    lines.push(`  │  Hits          : ${g.totalHits}   Direct Hits: ${g.totalDirectHits} (${directPct}% of hits)`);
    lines.push(`  │  Accuracy      : ${acc}%`);
    lines.push(`  │  Highest Wave  : ${g.wave}`);
    lines.push(`  │`);
    lines.push(`  │  SHOT-BY-SHOT LOG:`);
    lines.push(`  │  ${'─'.repeat(60)}`);
    lines.push(`  │  ${pad('COORDINATE', 16)} ${pad('RESULT', 12)} ${pad('ERROR (r)', 10)} ${pad('REACT(s)', 9)} WAVE`);
    lines.push(`  │  ${'─'.repeat(60)}`);
    g.log.forEach(entry => {
      const marker = entry.result === 'DIRECT HIT' ? '⭐' : entry.result === 'HIT' ? '✓' : entry.result === 'MISS' ? '✗' : '▸';
      lines.push(`  │  ${pad(entry.coord, 16)} ${pad(marker + ' ' + entry.result, 12)} ${pad(entry.error, 10)} ${pad(entry.timeS + 's', 9)} ${entry.wave}`);
    });
    lines.push(`  └${'─'.repeat(62)}`);
  });
  if (sessionGames.length > 1) {
    lines.push('');
    lines.push('══════════════════════════════════════════════════════════════════');
    lines.push('  SESSION SUMMARY — ARC OF LEARNING');
    lines.push('══════════════════════════════════════════════════════════════════');
    lines.push('');
    const header = `  ${pad('ENGAGEMENT', 12)} ${pad('SCORE', 8)} ${pad('ACCURACY', 10)} ${pad('DIRECT%', 8)} ${pad('KILLS', 7)} WAVE`;
    lines.push(header);
    lines.push('  ' + '─'.repeat(65));
    sessionGames.forEach(g => {
      const acc = g.totalShots > 0 ? Math.round((g.totalHits / g.totalShots) * 100) : 0;
      const directPct = g.totalHits > 0 ? Math.round((g.totalDirectHits / g.totalHits) * 100) : 0;
      lines.push(`  ${pad('GAME ' + g.gameNum, 12)} ${pad(g.score + 'pts', 8)} ${pad(acc + '%', 10)} ${pad(directPct + '%', 8)} ${pad(g.kills, 7)} ${g.wave}`);
    });
    lines.push('');
    if (sessionGames.length >= 2) {
      const g1 = sessionGames[0], gN = sessionGames[sessionGames.length - 1];
      const acc1 = g1.totalShots > 0 ? Math.round((g1.totalHits / g1.totalShots) * 100) : 0;
      const accN = gN.totalShots > 0 ? Math.round((gN.totalHits / gN.totalShots) * 100) : 0;
      const accDelta = accN - acc1;
      const scoreDelta = gN.score - g1.score;
      lines.push('  TREND ANALYSIS:');
      lines.push(`  Accuracy change   : ${accDelta >= 0 ? '+' : ''}${accDelta}% (Game 1 → Game ${sessionGames.length})`);
      lines.push(`  Score change      : ${scoreDelta >= 0 ? '+' : ''}${scoreDelta} pts`);
      if (accDelta > 10) lines.push('  Assessment        : Strong improvement in coordinate plotting accuracy.');
      else if (accDelta > 0) lines.push('  Assessment        : Modest improvement shown. Continue practice.');
      else if (accDelta === 0) lines.push('  Assessment        : Consistent performance. Push for higher wave difficulty.');
      else lines.push('  Assessment        : Performance declined — review angle quadrant identification.');
    }
  }
  lines.push('');
  lines.push('══════════════════════════════════════════════════════════════════');
  lines.push('  END OF REPORT — POLAR DEFENSE COMMAND');
  lines.push('══════════════════════════════════════════════════════════════════');
  const text = lines.join('\n');
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `AAR_${operator.last}_${operator.callsign}_${now.toISOString().slice(0, 10)}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}

// ═══════════════════════════════════════════════════════
//  START / RETRY
// ═══════════════════════════════════════════════════════
document.getElementById('retryBtn').addEventListener('click', () => {
  document.getElementById('overlay').style.display = 'none';
  currentGameNum++;
  startGame();
});

function startGame() {
  score = 0; streak = 0; totalShots = 0; totalHits = 0; totalDirectHits = 0;
  kills = 0; wave = 1; maxWave = 1; hp = 5;
  particles = []; friendlyProjectiles = []; enemyProjectiles = []; enemy = null;
  engagementLog = [];
  gameActive = true; phase = 'idle';
  turretAngle = 0; turretTarget = null; turretTurning = false;
  clearEnemyTimers();
  updateHP(); updateStats();
  document.getElementById('killLog').innerHTML = '— combat initiated —';
  document.getElementById('coordDisplay').textContent = '( r , θ )';
  document.getElementById('waveDisplay').textContent = '1';
  cancelAnimationFrame(animId);
  gameLoop();
  setTimeout(newTarget, 500);
}

gameLoop();
