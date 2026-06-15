/**
 * Tic-Tac-Toe — game.js
 * Handles: state management, Minimax AI, UI rendering,
 *          sound effects, confetti, dark/light theme, localStorage.
 */

// ── Constants ─────────────────────────────────────────────────────────────────

const WIN_LINES = [
  [0,1,2],[3,4,5],[6,7,8], // rows
  [0,3,6],[1,4,7],[2,5,8], // cols
  [0,4,8],[2,4,6]          // diagonals
];

const STORAGE_KEY = 'ttt_data';

// ── State ─────────────────────────────────────────────────────────────────────

let board        = Array(9).fill(null);  // null | 'X' | 'O'
let currentPlayer = 'X';                 // 'X' always goes first
let gameOver     = false;
let vsAI         = false;                // Human vs AI mode
let score        = { X: 0, O: 0, draw: 0 };
let stats        = { games: 0, xWins: 0, oWins: 0, draws: 0 };

// ── DOM Refs ──────────────────────────────────────────────────────────────────

const cells        = document.querySelectorAll('.cell');
const turnIndicator = document.getElementById('turnIndicator');
const turnSymbol   = document.getElementById('turnSymbol');
const turnText     = document.getElementById('turnText');
const scoreX       = document.getElementById('scoreX');
const scoreO       = document.getElementById('scoreO');
const scoreDraw    = document.getElementById('scoreDraw');
const labelX       = document.getElementById('labelX');
const labelO       = document.getElementById('labelO');
const modeLabel    = document.getElementById('modeLabel');
const modeToggle   = document.getElementById('modeToggle');
const themeBtn     = document.getElementById('themeBtn');
const themeIcon    = document.getElementById('themeIcon');
const modal        = document.getElementById('modal');
const modalIcon    = document.getElementById('modalIcon');
const modalTitle   = document.getElementById('modalTitle');
const modalMsg     = document.getElementById('modalMsg');
const statGames    = document.getElementById('statGames');
const statXWin     = document.getElementById('statXWin');
const statOWin     = document.getElementById('statOWin');
const statDrawPct  = document.getElementById('statDrawPct');

// ── Audio (Web Audio API, no files needed) ────────────────────────────────────

const audioCtx = (() => {
  try { return new (window.AudioContext || window.webkitAudioContext)(); }
  catch { return null; }
})();

/**
 * Plays a simple beep via Web Audio API.
 * @param {number} freq   Frequency in Hz
 * @param {number} dur    Duration in seconds
 * @param {'sine'|'square'|'triangle'} type Waveform
 * @param {number} vol    Volume 0-1
 */
function beep(freq = 440, dur = 0.12, type = 'sine', vol = 0.18) {
  if (!audioCtx) return;
  const osc  = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.type = type;
  osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
  gain.gain.setValueAtTime(vol, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur);
  osc.start(audioCtx.currentTime);
  osc.stop(audioCtx.currentTime + dur);
}

const playMove  = () => beep(currentPlayer === 'X' ? 520 : 380, 0.1, 'sine');
const playWin   = () => { beep(523,0.12); setTimeout(()=>beep(659,0.12),130); setTimeout(()=>beep(784,0.25),260); };
const playDraw  = () => beep(260, 0.3, 'triangle', 0.12);

// ── Persistence ───────────────────────────────────────────────────────────────

function saveData() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ score, stats, theme: document.documentElement.getAttribute('data-theme') }));
  } catch {}
}

function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (data.score) score = data.score;
    if (data.stats) stats = data.stats;
    if (data.theme) document.documentElement.setAttribute('data-theme', data.theme);
  } catch {}
}

// ── Rendering ─────────────────────────────────────────────────────────────────

/** Refreshes every cell's visual state */
function renderBoard() {
  cells.forEach((cell, i) => {
    const val = board[i];
    cell.textContent = val || '';
    cell.className   = 'cell' + (val ? ` ${val.toLowerCase()} taken` : '');
  });
}

/** Updates the turn indicator pill */
function renderTurn() {
  turnSymbol.textContent = currentPlayer;
  turnIndicator.className = `turn-indicator is-${currentPlayer.toLowerCase()}`;
  if (gameOver) { turnText.textContent = ''; return; }
  if (vsAI && currentPlayer === 'O') {
    turnText.textContent = 'AI thinking…';
  } else {
    turnText.textContent = vsAI ? 'Your turn' : `Player ${currentPlayer === 'X' ? '1' : '2'}'s turn`;
  }
}

/** Updates scoreboard numbers */
function renderScore() {
  scoreX.textContent    = score.X;
  scoreO.textContent    = score.O;
  scoreDraw.textContent = score.draw;
}

/** Updates the statistics section */
function renderStats() {
  const g = stats.games || 0;
  statGames.textContent   = g;
  statXWin.textContent    = g ? Math.round(stats.xWins / g * 100) + '%' : '0%';
  statOWin.textContent    = g ? Math.round(stats.oWins / g * 100) + '%' : '0%';
  statDrawPct.textContent = g ? Math.round(stats.draws / g * 100) + '%' : '0%';
}

/** Updates mode-related labels */
function renderModeLabels() {
  modeLabel.textContent = vsAI ? 'vs AI' : 'vs Human';
  labelX.textContent    = 'Player 1';
  labelO.textContent    = vsAI ? 'AI' : 'Player 2';
}

// ── Win Detection ─────────────────────────────────────────────────────────────

/**
 * Checks if a player has won on the given board snapshot.
 * @param {string[]} b  Board state
 * @param {string}   p  Player to check ('X' or 'O')
 * @returns {number[]|null}  Winning indices, or null
 */
function checkWin(b, p) {
  for (const line of WIN_LINES) {
    if (line.every(i => b[i] === p)) return line;
  }
  return null;
}

/** Returns true if the board has no empty cells */
function isBoardFull(b) { return b.every(v => v !== null); }

// ── Minimax AI ────────────────────────────────────────────────────────────────

/**
 * Minimax with alpha-beta pruning.
 * Returns the best score from the current player's perspective.
 *
 * @param {string[]} b       Board snapshot
 * @param {number}   depth   Current recursion depth
 * @param {boolean}  isMax   True when it's AI's (O) turn to maximise
 * @param {number}   alpha   Best score for maximiser found so far
 * @param {number}   beta    Best score for minimiser found so far
 * @returns {number}
 */
function minimax(b, depth, isMax, alpha, beta) {
  if (checkWin(b, 'O')) return 10 - depth;
  if (checkWin(b, 'X')) return depth - 10;
  if (isBoardFull(b))   return 0;

  if (isMax) {
    let best = -Infinity;
    for (let i = 0; i < 9; i++) {
      if (!b[i]) {
        b[i] = 'O';
        best = Math.max(best, minimax(b, depth + 1, false, alpha, beta));
        b[i] = null;
        alpha = Math.max(alpha, best);
        if (beta <= alpha) break; // β cut-off
      }
    }
    return best;
  } else {
    let best = Infinity;
    for (let i = 0; i < 9; i++) {
      if (!b[i]) {
        b[i] = 'X';
        best = Math.min(best, minimax(b, depth + 1, true, alpha, beta));
        b[i] = null;
        beta = Math.min(beta, best);
        if (beta <= alpha) break; // α cut-off
      }
    }
    return best;
  }
}

/**
 * Returns the index of the best move for the AI (O).
 * @returns {number}
 */
function getBestMove() {
  let bestScore = -Infinity;
  let bestIdx   = -1;
  for (let i = 0; i < 9; i++) {
    if (!board[i]) {
      board[i] = 'O';
      const score = minimax(board, 0, false, -Infinity, Infinity);
      board[i] = null;
      if (score > bestScore) { bestScore = score; bestIdx = i; }
    }
  }
  return bestIdx;
}

// ── Game Logic ────────────────────────────────────────────────────────────────

/**
 * Applies a move to the given cell index.
 * Handles win/draw detection and delegates AI moves.
 * @param {number} idx  Cell index 0-8
 */
function makeMove(idx) {
  if (gameOver || board[idx]) return;

  // Place piece
  board[idx] = currentPlayer;
  const cell = cells[idx];
  cell.textContent = currentPlayer;
  cell.classList.add(currentPlayer.toLowerCase(), 'taken', 'pop');
  cell.addEventListener('animationend', () => cell.classList.remove('pop'), { once: true });

  playMove();

  // Check win
  const winLine = checkWin(board, currentPlayer);
  if (winLine) {
    endGame('win', winLine);
    return;
  }

  // Check draw
  if (isBoardFull(board)) {
    endGame('draw');
    return;
  }

  // Switch player
  currentPlayer = currentPlayer === 'X' ? 'O' : 'X';
  renderTurn();

  // Trigger AI move if applicable
  if (vsAI && currentPlayer === 'O' && !gameOver) {
    setTimeout(aiMove, 420); // small delay feels natural
  }
}

/** Executes the AI's turn */
function aiMove() {
  if (gameOver) return;
  const idx = getBestMove();
  if (idx !== -1) makeMove(idx);
}

/**
 * Ends the current game, updating scores/stats, highlighting winners,
 * and showing the result modal.
 * @param {'win'|'draw'} result
 * @param {number[]}     [winLine]  Winning cell indices
 */
function endGame(result, winLine = []) {
  gameOver = true;
  turnText.textContent = '';

  if (result === 'win') {
    // Highlight winning cells
    winLine.forEach(i => cells[i].classList.add('winning'));

    score[currentPlayer]++;
    stats.games++;
    if (currentPlayer === 'X') stats.xWins++;
    else stats.oWins++;

    playWin();
    launchConfetti();

    const winnerName = vsAI
      ? (currentPlayer === 'X' ? 'You win!' : 'AI wins!')
      : `Player ${currentPlayer === 'X' ? '1' : '2'} wins!`;

    showModal(
      currentPlayer === 'X' ? '🎉' : (vsAI ? '🤖' : '🏆'),
      winnerName,
      `${currentPlayer} claimed the board.`
    );
  } else {
    score.draw++;
    stats.games++;
    stats.draws++;

    playDraw();
    showModal('🤝', "It's a draw!", 'Nobody wins this round.');
  }

  renderScore();
  renderStats();
  saveData();
}

// ── Modal ─────────────────────────────────────────────────────────────────────

function showModal(icon, title, msg) {
  modalIcon.textContent  = icon;
  modalTitle.textContent = title;
  modalMsg.textContent   = msg;
  modal.classList.add('open');
}

function hideModal() { modal.classList.remove('open'); }

// ── Reset Functions ───────────────────────────────────────────────────────────

/** Restarts the current game, keeping the scoreboard intact */
function restartGame() {
  board         = Array(9).fill(null);
  currentPlayer = 'X';
  gameOver      = false;
  hideModal();
  renderBoard();
  renderTurn();
  stopConfetti();
}

/** Clears scores and restarts */
function newMatch() {
  score = { X: 0, O: 0, draw: 0 };
  renderScore();
  restartGame();
  saveData();
}

// ── Confetti ─────────────────────────────────────────────────────────────────

let confettiCanvas, confettiCtx, confettiParticles, confettiRAF;

function launchConfetti() {
  stopConfetti();
  confettiCanvas = document.createElement('canvas');
  confettiCanvas.id = 'confetti-canvas';
  Object.assign(confettiCanvas.style, { position:'fixed', inset:0, width:'100%', height:'100%', pointerEvents:'none', zIndex:99 });
  document.body.appendChild(confettiCanvas);
  confettiCtx = confettiCanvas.getContext('2d');
  confettiCanvas.width  = window.innerWidth;
  confettiCanvas.height = window.innerHeight;

  const colors = ['#7c6af5','#f56a6a','#ffd670','#70f5a8','#70c8f5'];
  confettiParticles = Array.from({ length: 80 }, () => ({
    x:  Math.random() * confettiCanvas.width,
    y:  -10 - Math.random() * 40,
    w:  6 + Math.random() * 8,
    h:  10 + Math.random() * 14,
    r:  Math.random() * Math.PI * 2,
    dr: (Math.random() - 0.5) * 0.2,
    vx: (Math.random() - 0.5) * 2.5,
    vy: 3 + Math.random() * 4,
    color: colors[Math.floor(Math.random() * colors.length)],
    alpha: 1
  }));

  animateConfetti();
  setTimeout(stopConfetti, 3000);
}

function animateConfetti() {
  confettiCtx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
  let alive = false;
  for (const p of confettiParticles) {
    p.x += p.vx; p.y += p.vy; p.r += p.dr;
    if (p.y < confettiCanvas.height + 20) {
      alive = true;
      confettiCtx.save();
      confettiCtx.globalAlpha = p.alpha;
      confettiCtx.fillStyle = p.color;
      confettiCtx.translate(p.x, p.y);
      confettiCtx.rotate(p.r);
      confettiCtx.fillRect(-p.w/2, -p.h/2, p.w, p.h);
      confettiCtx.restore();
    }
  }
  if (alive) confettiRAF = requestAnimationFrame(animateConfetti);
  else stopConfetti();
}

function stopConfetti() {
  cancelAnimationFrame(confettiRAF);
  if (confettiCanvas) { confettiCanvas.remove(); confettiCanvas = null; }
}

// ── Theme ─────────────────────────────────────────────────────────────────────

function toggleTheme() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  document.documentElement.setAttribute('data-theme', isDark ? 'light' : 'dark');
  // Swap icon: moon for dark, sun for light
  themeIcon.innerHTML = isDark
    ? `<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>`
    : `<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>`;
  saveData();
}

// ── Mode Toggle ───────────────────────────────────────────────────────────────

function toggleMode() {
  vsAI = !vsAI;
  modeToggle.classList.toggle('active', vsAI);
  renderModeLabels();
  restartGame();
}

// ── Event Listeners ───────────────────────────────────────────────────────────

cells.forEach(cell => {
  const handler = () => {
    if (gameOver || board[cell.dataset.index]) return;
    if (vsAI && currentPlayer === 'O') return; // AI's turn
    // Resume AudioContext on first user interaction (browser policy)
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
    makeMove(Number(cell.dataset.index));
  };
  cell.addEventListener('click', handler);
  // Keyboard accessibility
  cell.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handler(); }
  });
});

document.getElementById('restartBtn').addEventListener('click', restartGame);
document.getElementById('newMatchBtn').addEventListener('click', newMatch);
document.getElementById('modalRestart').addEventListener('click', restartGame);
document.getElementById('modalNew').addEventListener('click', newMatch);
document.getElementById('themeBtn').addEventListener('click', toggleTheme);
document.getElementById('modeSwitch').addEventListener('click', toggleMode);

// Close modal on overlay click (outside modal box)
modal.addEventListener('click', e => { if (e.target === modal) hideModal(); });

// ── Init ──────────────────────────────────────────────────────────────────────

loadData();
renderBoard();
renderScore();
renderStats();
renderModeLabels();
renderTurn();
