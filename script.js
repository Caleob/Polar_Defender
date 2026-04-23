// ═══════════════════════════════════════════════════════
//  OPERATOR / PERSISTENT SESSION DATA
// ═══════════════════════════════════════════════════════
let operator = { first: '', last: '', callsign: '', difficulty: 'commander' };
let sessionGames = [];   // array of game result objects, persists across retries
let currentGameNum = 0;  // 1-indexed
const HELP_STORAGE_KEY = 'polarDefenderTutorialSeen';
let tutorialSeen = localStorage.getItem(HELP_STORAGE_KEY) === '1';
let pendingGameStart = false;
let briefResumeAction = null;

const resultMsgEl = document.getElementById('resultMsg');
if (resultMsgEl && !document.getElementById('shotState')) {
  const shotStateEl = document.createElement('div');
  shotStateEl.id = 'shotState';
  shotStateEl.className = 'shot-state idle';
  shotStateEl.textContent = 'READY TO INTERCEPT';
  resultMsgEl.parentNode.insertBefore(shotStateEl, resultMsgEl);
}

const statusPanel = resultMsgEl ? resultMsgEl.closest('.panel-box') : null;
if (statusPanel) {
  statusPanel.dataset.label = 'SHOT STATUS';
  statusPanel.classList.add('status-box');
}

const diffDescriptions = {
  recruit: 'DEGREES FIRST · LATE RADIANS · 10 SHIELDS · 1.0X SCORE',
  veteran: 'MIXED ANGLES · MIDGAME RADIANS · 7 SHIELDS · 1.25X SCORE',
  commander: 'EARLY RADIANS · NEGATIVE RADII · 5 SHIELDS · 1.5X SCORE'
};
document.querySelectorAll('input[name="difficulty"]').forEach(input => {
  const desc = input.closest('.diff-radio')?.querySelector('.diff-desc');
  if (desc && diffDescriptions[input.value]) desc.textContent = diffDescriptions[input.value];
});

// ═══════════════════════════════════════════════════════
//  LOGIN
// ═══════════════════════════════════════════════════════
document.getElementById('loginBtn').addEventListener('click', submitLogin);
document.addEventListener('keydown', e => {
  if (document.getElementById('loginScreen').style.display !== 'none' &&
    document.getElementById('loginScreen').style.display !== '') return;
  if (e.code === 'KeyP') {
    togglePause();
    return;
  }
  if (e.code === 'Escape' && document.getElementById('missionBrief').classList.contains('open')) {
    closeMissionBrief();
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

  const diffRadio = document.querySelector('input[name="difficulty"]:checked');
  const difficulty = diffRadio ? diffRadio.value : 'commander';

  operator = { first, last, callsign, difficulty };
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
const ANGLE_SETS = {
  benchmark: [0, 30, 45, 60, 90, 120, 135, 150, 180, 210, 225, 240, 270, 300, 315, 330],
  every15: Array.from({ length: 24 }, (_, i) => i * 15),
  every30: Array.from({ length: 12 }, (_, i) => i * 30)
};

const DIFFICULTY_SETTINGS = {
  recruit: {
    maxHp: 10,
    warningBonus: 2500,
    fireBonus: 800,
    scoreMultiplier: 1.0,
    label: 'RECRUIT',
    brief: 'Recruit emphasizes degree recognition first and waits until late waves to introduce radians.'
  },
  veteran: {
    maxHp: 7,
    warningBonus: 1200,
    fireBonus: 400,
    scoreMultiplier: 1.25,
    label: 'VETERAN',
    brief: 'Veteran mixes degree and radian labels by midgame and adds limited negative-radius practice.'
  },
  commander: {
    maxHp: 5,
    warningBonus: 0,
    fireBonus: 0,
    scoreMultiplier: 1.5,
    label: 'COMMANDER',
    brief: 'Commander reaches radians early and introduces negative radii in the back half of the mission.'
  }
};

const DIFFICULTY_WAVES = {
  recruit: [
    { angles: ANGLE_SETS.every30, labelMode: 'degree', radii: [1, 2, 3], negativeRadii: false, warningMs: 7200, fireMs: 1400 },
    { angles: ANGLE_SETS.benchmark, labelMode: 'degree', radii: [1, 2, 3, 4], negativeRadii: false, warningMs: 6800, fireMs: 1280 },
    { angles: ANGLE_SETS.benchmark, labelMode: 'degree', radii: [1, 2, 3, 4], negativeRadii: false, warningMs: 6400, fireMs: 1200 },
    { angles: ANGLE_SETS.every15, labelMode: 'degree', radii: [1, 2, 3, 4, 5], negativeRadii: false, warningMs: 6000, fireMs: 1120 },
    { angles: ANGLE_SETS.benchmark, labelMode: 'degree', radii: [1, 2, 3, 4, 5], negativeRadii: false, warningMs: 5600, fireMs: 1040 },
    { angles: ANGLE_SETS.benchmark, labelMode: 'degree', radii: [1, 2, 3, 4, 5], negativeRadii: false, warningMs: 5200, fireMs: 980 },
    { angles: ANGLE_SETS.benchmark, labelMode: 'radian', radii: [1, 2, 3, 4, 5], negativeRadii: false, warningMs: 4900, fireMs: 940 },
    { angles: ANGLE_SETS.benchmark, labelMode: 'mixed', radii: [1, 2, 3, 4, 5], negativeRadii: false, warningMs: 4600, fireMs: 900 },
    { angles: ANGLE_SETS.benchmark, labelMode: 'radian', radii: [1, 2, 3, 4, 5], negativeRadii: false, warningMs: 4300, fireMs: 860 },
    { angles: ANGLE_SETS.every15, labelMode: 'mixed', radii: [1, 2, 3, 4, 5], negativeRadii: false, warningMs: 4000, fireMs: 820 }
  ],
  veteran: [
    { angles: ANGLE_SETS.benchmark, labelMode: 'degree', radii: [1, 2, 3], negativeRadii: false, warningMs: 6200, fireMs: 1220 },
    { angles: ANGLE_SETS.every15, labelMode: 'degree', radii: [1, 2, 3, 4], negativeRadii: false, warningMs: 5800, fireMs: 1120 },
    { angles: ANGLE_SETS.benchmark, labelMode: 'mixed', radii: [1, 2, 3, 4], negativeRadii: false, warningMs: 5400, fireMs: 1020 },
    { angles: ANGLE_SETS.benchmark, labelMode: 'radian', radii: [1, 2, 3, 4, 5], negativeRadii: false, warningMs: 5000, fireMs: 960 },
    { angles: ANGLE_SETS.every15, labelMode: 'mixed', radii: [1, 2, 3, 4, 5], negativeRadii: false, warningMs: 4700, fireMs: 900 },
    { angles: ANGLE_SETS.every15, labelMode: 'radian', radii: [1, 2, 3, 4, 5], negativeRadii: false, warningMs: 4400, fireMs: 860 },
    { angles: ANGLE_SETS.benchmark, labelMode: 'mixed', radii: [2, 3, 4, 5], negativeRadii: true, warningMs: 4100, fireMs: 820 },
    { angles: ANGLE_SETS.every15, labelMode: 'radian', radii: [2, 3, 4, 5], negativeRadii: true, warningMs: 3800, fireMs: 780 },
    { angles: ANGLE_SETS.every15, labelMode: 'mixed', radii: [1, 2, 3, 4, 5], negativeRadii: true, warningMs: 3500, fireMs: 740 },
    { angles: ANGLE_SETS.every15, labelMode: 'radian', radii: [1, 2, 3, 4, 5], negativeRadii: true, warningMs: 3200, fireMs: 700 }
  ],
  commander: [
    { angles: ANGLE_SETS.benchmark, labelMode: 'mixed', radii: [1, 2, 3, 4], negativeRadii: false, warningMs: 5200, fireMs: 980 },
    { angles: ANGLE_SETS.benchmark, labelMode: 'radian', radii: [1, 2, 3, 4, 5], negativeRadii: false, warningMs: 4800, fireMs: 900 },
    { angles: ANGLE_SETS.every15, labelMode: 'radian', radii: [1, 2, 3, 4, 5], negativeRadii: false, warningMs: 4400, fireMs: 820 },
    { angles: ANGLE_SETS.every15, labelMode: 'mixed', radii: [1, 2, 3, 4, 5], negativeRadii: false, warningMs: 4000, fireMs: 760 },
    { angles: ANGLE_SETS.every15, labelMode: 'radian', radii: [1, 2, 3, 4, 5], negativeRadii: true, warningMs: 3700, fireMs: 720 },
    { angles: ANGLE_SETS.every15, labelMode: 'radian', radii: [2, 3, 4, 5], negativeRadii: true, warningMs: 3400, fireMs: 680 },
    { angles: ANGLE_SETS.every15, labelMode: 'mixed', radii: [2, 3, 4, 5], negativeRadii: true, warningMs: 3100, fireMs: 650 },
    { angles: ANGLE_SETS.every15, labelMode: 'radian', radii: [1, 2, 3, 4, 5], negativeRadii: true, warningMs: 2800, fireMs: 620 },
    { angles: ANGLE_SETS.every15, labelMode: 'mixed', radii: [1, 2, 3, 4, 5], negativeRadii: true, warningMs: 2550, fireMs: 590 },
    { angles: ANGLE_SETS.every15, labelMode: 'radian', radii: [1, 2, 3, 4, 5], negativeRadii: true, warningMs: 2300, fireMs: 560 }
  ]
};

function getWaveProfile() {
  const profiles = DIFFICULTY_WAVES[operator.difficulty] || DIFFICULTY_WAVES.commander;
  return profiles[Math.min(wave, profiles.length) - 1];
}

function getTargetThetaLabel(theta, labelMode) {
  if (labelMode === 'degree') return `${theta}\u00B0`;
  if (labelMode === 'radian') return degreeToRadianStr(theta);
  return Math.random() < 0.5 ? `${theta}\u00B0` : degreeToRadianStr(theta);
}

function setShotState(label, state = 'idle') {
  const el = document.getElementById('shotState');
  if (!el) return;
  el.textContent = label;
  el.className = `shot-state ${state}`;
}

function updateBriefSummary() {
  const el = document.getElementById('briefDifficultySummary');
  if (!el) return;
  const diff = DIFFICULTY_SETTINGS[operator.difficulty] || DIFFICULTY_SETTINGS.commander;
  el.textContent = `${diff.label}: ${diff.brief}`;
}

function openMissionBrief() {
  updateBriefSummary();
  const brief = document.getElementById('missionBrief');
  brief.classList.add('open');
  brief.setAttribute('aria-hidden', 'false');
}

function closeMissionBrief() {
  const brief = document.getElementById('missionBrief');
  brief.classList.remove('open');
  brief.setAttribute('aria-hidden', 'true');

  if (!tutorialSeen) {
    tutorialSeen = true;
    localStorage.setItem(HELP_STORAGE_KEY, '1');
  }

  if (pendingGameStart) {
    pendingGameStart = false;
    startGame();
    return;
  }

  if (typeof briefResumeAction === 'function') {
    const resume = briefResumeAction;
    briefResumeAction = null;
    resume();
  }
}

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
  DEBUG: false
};

const POLAR_TOLERANCE = {
  DIRECT_RADIUS: 0.25,
  DIRECT_ANGLE: 6,
  HIT_RADIUS: 0.5,
  HIT_ANGLE: 12
};

const MAX_R = 5;
const UNIT = (W / 2 - 32) / MAX_R;
const TURRET_SPEED = APP_CONFIG.TURRET_SPEED;

// ═══════════════════════════════════════════════════════
//  GAME STATE
// ═══════════════════════════════════════════════════════
let score = 0, streak = 0, totalShots = 0, totalHits = 0, totalDirectHits = 0;
let kills = 0, wave = 1, maxWave = 1;
let hp = 5, gameActive = false, gamePaused = false;
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
let targetProfile = null;

// ═══════════════════════════════════════════════════════
//  AUDIO / MUTE HANDLING
// ═══════════════════════════════════════════════════════
let musicMuted = false;
let sfxMuted = false;

const bgMusic = document.getElementById('bgMusic');
const winMusic = document.getElementById('winMusic');
const sfxEmerge = document.getElementById('sfxEmerge');
const sfxExplode = document.getElementById('sfxExplode');
const sfxEnemyFire = document.getElementById('sfxEnemyFire');
const sfxTurretFire = document.getElementById('sfxTurretFire');
const sfxTurretMiss = document.getElementById('sfxTurretMiss');
const pauseMusic = document.getElementById('pauseMusic');

// Lower music volume for better background blend
bgMusic.volume = 0.4;
pauseMusic.volume = 0.4;
winMusic.volume = 0.5;

// Initialize toggle state
document.getElementById('musicToggle').classList.add('on');
document.getElementById('sfxToggle').classList.add('on');

document.getElementById('musicToggle').addEventListener('click', (e) => {
  musicMuted = !musicMuted;
  e.target.textContent = musicMuted ? '🎵 MUSIC: OFF' : '🎵 MUSIC: ON';
  e.target.classList.toggle('on', !musicMuted);
  if (musicMuted) {
    bgMusic.pause();
    winMusic.pause();
  } else if (gameActive && wave <= 10) {
    bgMusic.play().catch(e => console.log('Audio play error:', e));
  } else if (!gameActive && wave > 10) {
    winMusic.play().catch(e => console.log('Audio play error:', e));
  }
});

document.getElementById('sfxToggle').addEventListener('click', (e) => {
  sfxMuted = !sfxMuted;
  e.target.textContent = sfxMuted ? '🔊 SFX: OFF' : '🔊 SFX: ON';
  e.target.classList.toggle('on', !sfxMuted);
});

document.getElementById('pauseBtn').addEventListener('click', togglePause);
document.getElementById('briefStartBtn').addEventListener('click', closeMissionBrief);
document.getElementById('briefSkipBtn').addEventListener('click', closeMissionBrief);
document.getElementById('helpBtn').addEventListener('click', () => {
  if (document.getElementById('missionBrief').classList.contains('open')) {
    closeMissionBrief();
    return;
  }

  if (gameActive && !gamePaused) {
    togglePause();
    briefResumeAction = () => {
      if (gamePaused) togglePause();
    };
  } else {
    briefResumeAction = null;
  }

  openMissionBrief();
});

function togglePause() {
  if (!gameActive) return;
  gamePaused = !gamePaused;
  const btn = document.getElementById('pauseBtn');
  btn.classList.toggle('pause-btn-active', gamePaused);
  btn.textContent = gamePaused ? '▶ RESUME PLAY' : '⏸ PAUSE (TEMPORAL DELAY)';

  const cd = document.getElementById('coordDisplay');

  if (gamePaused) {
    if (cd.textContent !== 'GAME PAUSED') {
      cd.dataset.originalText = cd.textContent;
    }
    cd.textContent = 'GAME PAUSED';
    cd.style.fontSize = '1.8rem';
    cd.style.color = 'var(--orange)';
    
    const hint = document.getElementById('hintText');
    hint.dataset.originalHtml = hint.innerHTML;
    hint.style.visibility = 'hidden';
    
    // If music is playing, switch to pause music
    if (!musicMuted) {
      bgMusic.pause();
      pauseMusic.play().catch(e => console.log('Audio play error:', e));
    }
  } else {
    if (cd.dataset.originalText) {
      cd.textContent = cd.dataset.originalText;
    }
    cd.style.fontSize = '';
    cd.style.color = '';
    
    const hint = document.getElementById('hintText');
    hint.style.visibility = 'visible';
    
    // Switch back to bg music
    pauseMusic.pause();
    pauseMusic.currentTime = 0;
    if (!musicMuted && wave <= 10) {
      bgMusic.play().catch(e => console.log('Audio play error:', e));
    }
  }
}

function playSfx(audioEl) {
  if (sfxMuted || !audioEl) return;
  audioEl.currentTime = 0;
  audioEl.play().catch(e => console.log('Audio play error:', e));
}

// ═══════════════════════════════════════════════════════
//  DIFFICULTY
// ═══════════════════════════════════════════════════════
function getWarningMs() {
  return getWaveProfile().warningMs;
}

function getEnemyFireMs() {
  return getWaveProfile().fireMs;
}

// ═══════════════════════════════════════════════════════
//  COORDINATE UTIL
// ═══════════════════════════════════════════════════════
function polarToCanvas(r, deg) {
  const rad = deg * Math.PI / 180;
  return { x: CX + r * UNIT * Math.cos(rad), y: CY - r * UNIT * Math.sin(rad) };
}

function canvasToPolar(x, y) {
  const dx = x - CX;
  const dy = CY - y;
  const radius = Math.sqrt(dx * dx + dy * dy) / UNIT;
  let theta = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
  return { radius, theta };
}

function angleDiffDeg(a, b) {
  const diff = Math.abs(a - b) % 360;
  return diff > 180 ? 360 - diff : diff;
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
  targetProfile = getWaveProfile();

  const baseRadius = targetProfile.radii[Math.floor(Math.random() * targetProfile.radii.length)];
  const signedRadius = targetProfile.negativeRadii && Math.random() < 0.3 ? -baseRadius : baseRadius;
  const theta = targetProfile.angles[Math.floor(Math.random() * targetProfile.angles.length)];
  const resolvedTheta = signedRadius < 0 ? (theta + 180) % 360 : theta;
  const resolvedRadius = Math.abs(signedRadius);
  const pos = polarToCanvas(resolvedRadius, resolvedTheta);
  
  let thetaStr = `${theta}°`;
  thetaStr = getTargetThetaLabel(theta, targetProfile.labelMode);
  
  currentTarget = { r: signedRadius, theta, thetaStr, x: pos.x, y: pos.y, resolvedRadius, resolvedTheta };

  const cd = document.getElementById('coordDisplay');
  const newText = `( ${signedRadius} , ${thetaStr} )`;
  if (gamePaused) {
    cd.dataset.originalText = newText;
  } else {
    cd.textContent = newText;
  }

  setShotState('READY TO INTERCEPT', 'idle');
  setResult('— TAP THE RADAR TO COMMIT THE SHOT —', 'r-wait');
  const hint = document.getElementById('hintText');
  const newHint = `Threat at <b style="color:var(--red)">(${signedRadius}, ${thetaStr})</b> — tap the matching radar point before it fires.`;
  if (gamePaused) {
    hint.dataset.originalHtml = newHint;
  } else {
    hint.innerHTML = newHint;
  }

  startWarningBar();
}

function startWarningBar() {
  const dur = getWarningMs();
  let rem = dur;
  clearInterval(warningTickId);
  warningTickId = setInterval(() => {
    if (!gameActive) { clearInterval(warningTickId); return; }
    if (gamePaused) return;
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
  playSfx(sfxEmerge);

  clearInterval(enemyFireId);
  enemyFireId = setInterval(() => {
    if (!gameActive || !enemy || !enemy.alive || gamePaused) return;
    launchEnemyShot();
  }, getEnemyFireMs());
}

function launchEnemyShot() {
  const ex = enemy.x, ey = enemy.y;
  const tx = CX + (Math.random() - 0.5) * 25, ty = CY + (Math.random() - 0.5) * 25;
  const steps = 24; let step = 0;
  const p = { x: ex, y: ey };
  enemyProjectiles.push(p);
  playSfx(sfxEnemyFire);
  const id = setInterval(() => {
    if (gamePaused) return;
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
canvas.addEventListener('pointerdown', e => {
  if (!gameActive || gamePaused || !currentTarget || phase === 'resolving' || phase === 'idle') return;
  if (turretTurning) return;
  const rect = canvas.getBoundingClientRect();
  const sx = W / rect.width, sy = H / rect.height;
  playerClick = { x: (e.clientX - rect.left) * sx, y: (e.clientY - rect.top) * sy };
  turretTarget = Math.atan2(playerClick.y - CY, playerClick.x - CX);
  turretTurning = true;
  setShotState('LOCKING TARGET', 'locking');
  playSfx(sfxTurretFire);
  setResult('— TARGET LOCKED — FIRING SOLUTION CALCULATING —', 'r-wait blink');
});

// ═══════════════════════════════════════════════════════
//  FIRE RESOLUTION
// ═══════════════════════════════════════════════════════
function executeFire() {
  turretTurning = false;
  if (!gameActive || !playerClick || !currentTarget) return;
  setShotState('FIRING', 'firing');
  totalShots++;
  const elapsed = spawnTime ? (Date.now() - spawnTime) / 1000 : 999;

  launchFriendlyProjectile(CX, CY, playerClick.x, playerClick.y, () => {
    const selected = canvasToPolar(playerClick.x, playerClick.y);
    const radiusError = Math.abs(selected.radius - currentTarget.resolvedRadius);
    const angleError = angleDiffDeg(selected.theta, currentTarget.resolvedTheta);
    const errorStr = `${radiusError.toFixed(2)}r / ${angleError.toFixed(1)}°`;
    const isDirect = radiusError <= POLAR_TOLERANCE.DIRECT_RADIUS && angleError <= POLAR_TOLERANCE.DIRECT_ANGLE;
    const isHit = radiusError <= POLAR_TOLERANCE.HIT_RADIUS && angleError <= POLAR_TOLERANCE.HIT_ANGLE;

      if (isHit) {
      clearEnemyTimers();
      playSfx(sfxExplode);
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
      const mult = DIFFICULTY_SETTINGS[operator.difficulty].scoreMultiplier;
      const basePts = (isDirect ? APP_CONFIG.SCORE_DIRECT_HIT : APP_CONFIG.SCORE_HIT) + timeBonus + streak * APP_CONFIG.STREAK_BONUS;
      const pts = Math.round(basePts * mult);
      score += pts;

      let resultStr = '';
      if (!enemy && phase === 'warning') {
          resultStr = isDirect ? 'PRE-EMPTIVE DIRECT' : 'PRE-EMPTIVE STRIKE';
      } else {
          resultStr = isDirect ? 'DIRECT HIT' : 'HIT';
      }
      
      const tStr = currentTarget.thetaStr || `${currentTarget.theta}°`;
      engagementLog.push({ coord: `(${currentTarget.r}, ${tStr})`, result: resultStr, error: errorStr, timeS: elapsed.toFixed(1), wave, pts });

      if (isDirect) {
        setResult(resultStr.includes('PRE-') ? `⚡ ${resultStr}! +${pts} pts` : `⭐ ${resultStr}!  +${pts} pts`, 'r-direct');
        addLog(`<span class="log-direct">${resultStr.includes('PRE-') ? '⚡' : '⭐'} ${resultStr} (${currentTarget.r}, ${tStr}) err:${errorStr} t:${elapsed.toFixed(1)}s +${pts}pts</span>`);
      } else {
        setResult(resultStr.includes('PRE-') ? `⚡ ${resultStr}! +${pts} pts (errorStr${errorStr})` : `✓ ${resultStr}!  +${pts} pts  (errorStr${errorStr})`, 'r-hit');
        addLog(`<span class="log-hit">${resultStr.includes('PRE-') ? '⚡' : '✓'} ${resultStr} (${currentTarget.r}, ${tStr}) err:${errorStr} t:${elapsed.toFixed(1)}s +${pts}pts</span>`);
      }

      setShotState('TARGET DOWN', 'cooldown');
      phase = 'resolving'; updateStats();
      let shouldAdvance = false;
      if (APP_CONFIG.DEBUG && wave <= 5) {
        if (kills === wave) shouldAdvance = true;
      } else {
        if (kills > 0 && kills % APP_CONFIG.KILLS_PER_WAVE === 0) shouldAdvance = true;
      }

      if (shouldAdvance) {
        wave++;
        if (wave > 10) {
          setTimeout(() => { if (gameActive) gameWon(); }, 900);
          return;
        } else {
          showWaveAnnounce();
        }
      }
      setTimeout(() => { if (gameActive) advanceRound(); }, 900);

    } else {
      playSfx(sfxTurretMiss);
      spawnParticles(playerClick.x, playerClick.y, '#886600', 10);
      const tStr = currentTarget.thetaStr || `${currentTarget.theta}°`;
      setResult(`✗ MISS — off by ${errorStr} units — RE-AIM!`, 'r-miss');
      addLog(`<span class="log-miss">✗ MISS (${currentTarget.r}, ${tStr}) err:${errorStr}</span>`);
      engagementLog.push({ coord: `(${currentTarget.r}, ${tStr})`, result: 'MISS', error: errorStr, timeS: elapsed.toFixed(1), wave, pts: 0 });
      streak = 0; playerClick = null;
      setShotState('ADJUST AND RETRY', 'idle');
      updateStats();
    }
  });
}

function launchFriendlyProjectile(x1, y1, x2, y2, onDone) {
  const steps = 22; let step = 0;
  const p = { x: x1, y: y1, px: x1, py: y1 };
  friendlyProjectiles.push(p);
  const id = setInterval(() => {
    if (gamePaused) return;
    p.px = p.x; p.py = p.y;
    p.x = x1 + (x2 - x1) * (step / steps); p.y = y1 + (y2 - y1) * (step / steps); step++;
    if (step > steps) { clearInterval(id); const i = friendlyProjectiles.indexOf(p); if (i !== -1) friendlyProjectiles.splice(i, 1); onDone(); }
  }, 13);
}

// ═══════════════════════════════════════════════════════
//  DRAW LOOP
// ═══════════════════════════════════════════════════════
function gameLoop() {
  if (!gamePaused) {
    drawRadarBg(); drawEnemy(); drawPlayerAim();
    drawProjectiles(); drawParticles(); drawTurret();
  } else {
    // While paused, still draw to keep screen content but skip logic/animations
    // Note: Some draw calls have side effects (updates), so we might want a 'static' draw or just skip
    // To preserve the 'frozen' look, we can just skip the whole loop if paused, but 
    // that might cause flicker if we don't clear. 
    // Actually, keeping the last frame is better.
  }
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
  const maxHp = DIFFICULTY_SETTINGS[operator.difficulty].maxHp;
  for (let i = 1; i <= maxHp; i++) {
    const pip = document.getElementById('hp' + i);
    if (pip && i <= hp) { pip.classList.add('flash'); setTimeout(() => pip.classList.remove('flash'), 350); }
  }
  updateHP();
}

function updateHP() {
  const maxHp = DIFFICULTY_SETTINGS[operator.difficulty].maxHp;
  for (let i = 1; i <= maxHp; i++) {
    const pip = document.getElementById('hp' + i);
    if (pip) pip.classList.toggle('dead', i > hp);
  }
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
  setShotState('SCANNING FOR NEXT THREAT', 'cooldown');
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
  if (!log) return;
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
//  GAME OVER / WIN CONDITIONS
// ═══════════════════════════════════════════════════════
function gameWon() {
  gameActive = false; clearEnemyTimers(); enemy = null; phase = 'idle';
  bgMusic.pause();
  pauseMusic.pause();
  pauseMusic.currentTime = 0;
  if (!musicMuted) winMusic.play().catch(e => console.log('Audio play error:', e));

  const acc = totalShots > 0 ? Math.round((totalHits / totalShots) * 100) : 0;
  sessionGames.push({
    gameNum: currentGameNum,
    score, kills, totalShots, totalHits, totalDirectHits,
    wave: 10, acc,
    log: [...engagementLog]
  });

  document.getElementById('gameCounter').textContent = `ENGAGEMENT ${currentGameNum} OF SESSION`;
  document.getElementById('finalScore').textContent = score + ' pts';
  document.getElementById('overlayStats').innerHTML =
    `Shots fired: <b style="color:var(--green)">${totalShots}</b> &nbsp;
     Kills: <b style="color:var(--green)">${kills}</b> &nbsp;
     Direct hits: <b style="color:var(--yellow)">${totalDirectHits}</b> &nbsp;
     Accuracy: <b style="color:var(--green)">${acc}%</b><br>
     Max wave reached: <b style="color:var(--cyan)">10 (CLEARED)</b>`;
     
  const overlay = document.getElementById('overlay');
  overlay.querySelector('h1').textContent = "SECTOR CLEARED";
  overlay.querySelector('h1').style.color = "var(--green)";
  overlay.querySelector('h1').style.textShadow = "0 0 30px var(--green), 0 0 60px var(--green)";
  overlay.style.background = `rgba(2, 13, 8, 0.94) url('End Still.png') center/cover no-repeat`;
  overlay.style.display = 'flex';
}

function gameOver() {
  gameActive = false; clearEnemyTimers(); enemy = null; phase = 'idle';
  bgMusic.pause();
  pauseMusic.pause();
  pauseMusic.currentTime = 0;
  
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
     
  const overlay = document.getElementById('overlay');
  overlay.querySelector('h1').textContent = "BASE DESTROYED";
  overlay.querySelector('h1').style.color = "var(--red)";
  overlay.querySelector('h1').style.textShadow = "0 0 30px var(--red), 0 0 60px var(--red)";
  overlay.style.background = `rgba(2, 13, 8, 0.94)`;
  overlay.style.display = 'flex';
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
  lines.push(`  CHALLENGE: ${DIFFICULTY_SETTINGS[operator.difficulty].label} (${DIFFICULTY_SETTINGS[operator.difficulty].scoreMultiplier}x Score Modifier)`);
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
  winMusic.pause();
  winMusic.currentTime = 0;
  currentGameNum++;
  startGame();
});

function startGame() {
  score = 0; streak = 0; totalShots = 0; totalHits = 0; totalDirectHits = 0;
  kills = 0; wave = 1; maxWave = 1; 
  
  const maxHp = DIFFICULTY_SETTINGS[operator.difficulty].maxHp;
  hp = maxHp;
  
  // Rebuild the HP bar
  const hpBar = document.getElementById('hpBar');
  hpBar.innerHTML = '';
  for (let i = 1; i <= maxHp; i++) {
    const pip = document.createElement('div');
    pip.className = 'hp-pip';
    pip.id = 'hp' + i;
    hpBar.appendChild(pip);
  }

  particles = []; friendlyProjectiles = []; enemyProjectiles = []; enemy = null;
  engagementLog = [];
  gameActive = true; gamePaused = false; phase = 'idle';
  turretAngle = 0; turretTarget = null; turretTurning = false;
  targetProfile = null;
  
  const pauseBtn = document.getElementById('pauseBtn');
  pauseBtn.classList.remove('pause-btn-active');
  pauseBtn.textContent = '⏸ PAUSE (TEMPORAL DELAY)';
  pauseMusic.pause();
  pauseMusic.currentTime = 0;
  clearEnemyTimers();
  updateHP(); updateStats();
  const kl = document.getElementById('killLog');
  if (kl) kl.innerHTML = '— combat initiated —';
  document.getElementById('coordDisplay').textContent = '( r , θ )';
  document.getElementById('hintText').innerHTML =
    'Intercept the threat at <b>( r , θ )</b> before it opens fire.<br>Tap the matching radar position once to lock and fire.';
  setShotState('READY TO INTERCEPT', 'idle');
  setResult('— AWAITING TARGET —', 'r-wait');
  document.getElementById('waveDisplay').textContent = '1';
  cancelAnimationFrame(animId);

  // Resume music
  if (!musicMuted) {
    bgMusic.currentTime = 0;
    bgMusic.play().catch(e => console.log('Audio play error:', e));
  }

  gameLoop();
  setTimeout(newTarget, 500);
}

gameLoop();
