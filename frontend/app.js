// --- ELEMENTI DOM ---
const timerDisplay = document.getElementById('timer-display');
const timerHint = document.getElementById('timer-hint');
const timerTouchArea = document.getElementById('timer-touch-area');
const scrambleText = document.getElementById('scramble-text');
const btnNewScramble = document.getElementById('btn-new-scramble');
const manualInput = document.getElementById('manual-input');
const modeButtons = document.querySelectorAll('.mode-btn');

// Viste Scramble
const views = {
    auto: document.getElementById('auto-scramble-view'),
    manual: document.getElementById('manual-scramble-view'),
    free: document.getElementById('free-scramble-view')
};

// Statistiche DOM
const statLast = document.getElementById('stat-last');
const statPb = document.getElementById('stat-pb');
const statAo5 = document.getElementById('stat-ao5');
const statCount = document.getElementById('stat-count');
const timesList = document.getElementById('times-list');
const btnClear = document.getElementById('btn-clear');

// --- STATO DELL'APPLICAZIONE ---
let state = 'IDLE'; // IDLE | HOLDING | READY | RUNNING | STOPPED
let holdTimeout = null;
let startTime = 0;
let animationFrameId = null;
let currentMode = 'auto';
let currentScramble = '';
let solves = []; // Array temporaneo in memoria (nella Fase 2 lo salveremo in Python/SQLite!)

// --- 1. GENERATORE DI SCRAMBLE 3x3 (Anti-ridondanza) ---
function generateScramble(length = 20) {
    const faces = ['R', 'L', 'U', 'D', 'F', 'B'];
    const modifiers = ['', "'", '2'];
    const opposite = { R: 'L', L: 'R', U: 'D', D: 'U', F: 'B', B: 'F' };

    let sequence = [];
    let lastFace = '';
    let secondLastFace = '';

    while (sequence.length < length) {
        const face = faces[Math.floor(Math.random() * faces.length)];
        // Evita due mosse consecutive sulla stessa faccia (es. R R') o sequenze inutili tipo R L R
        if (face === lastFace || (face === secondLastFace && opposite[face] === lastFace)) {
            continue;
        }
        const mod = modifiers[Math.floor(Math.random() * modifiers.length)];
        sequence.push(face + mod);
        secondLastFace = lastFace;
        lastFace = face;
    }

    currentScramble = sequence.join(' ');
    scrambleText.textContent = currentScramble;
}

// Cambio modalità Scramble (Generato / Manuale / Libero)
modeButtons.forEach(btn => {
    btn.addEventListener('click', () => {
        btn.blur(); // Toglie il focus dal bottone così la barra spaziatrice non lo riclicca!
        modeButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        currentMode = btn.dataset.mode;
        Object.values(views).forEach(v => v.classList.add('hidden'));
        views[currentMode].classList.remove('hidden');

        if (currentMode === 'auto' && !currentScramble) generateScramble();
    });
});

btnNewScramble.addEventListener('click', () => {
    btnNewScramble.blur();
    generateScramble();
});

// --- 2. LOGICA DEL CRONOMETRO FLUIDO (2 cifre decimali) ---
function formatTime(ms) {
    const totalSeconds = ms / 1000;
    if (totalSeconds < 60) {
        return totalSeconds.toFixed(2); // Es: 12.48
    }
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = (totalSeconds % 60).toFixed(2).padStart(5, '0');
    return `${minutes}:${seconds}`; // Es: 1:04.25
}

function updateTimerLoop() {
    if (state !== 'RUNNING') return;
    const elapsed = performance.now() - startTime;
    timerDisplay.textContent = formatTime(elapsed);
    animationFrameId = requestAnimationFrame(updateTimerLoop);
}

function handlePressStart() {
    // Se l'utente sta scrivendo nello scramble manuale, non attivare il timer
    if (document.activeElement === manualInput) return;

    if (state === 'RUNNING') {
        // FERMA IL TIMER
        state = 'STOPPED';
        cancelAnimationFrame(animationFrameId);
        const finalMs = performance.now() - startTime;
        timerDisplay.textContent = formatTime(finalMs);
        timerDisplay.className = 'timer-digits';
        timerHint.classList.remove('fade');

        recordSolve(finalMs);
        if (currentMode === 'auto') generateScramble();
        return;
    }

    if (state === 'IDLE' || state === 'STOPPED') {
        state = 'HOLDING';
        timerDisplay.className = 'timer-digits holding';
        // Dopo 300ms di pressione diventa verde ("Pronto!") come nei timer ufficiali Stackmat
        holdTimeout = setTimeout(() => {
            if (state === 'HOLDING') {
                state = 'READY';
                timerDisplay.className = 'timer-digits ready';
                timerDisplay.textContent = '0.00';
            }
        }, 300);
    }
}

function handlePressEnd() {
    if (document.activeElement === manualInput) return;

    if (state === 'HOLDING') {
        // Rilasciato troppo presto
        clearTimeout(holdTimeout);
        state = 'IDLE';
        timerDisplay.className = 'timer-digits';
    } else if (state === 'READY') {
        // PARTE IL TIMER!
        state = 'RUNNING';
        timerDisplay.className = 'timer-digits running';
        timerHint.classList.add('fade');
        startTime = performance.now();
        animationFrameId = requestAnimationFrame(updateTimerLoop);
    } else if (state === 'STOPPED') {
        state = 'IDLE';
    }
}

// Eventi Tastiera (Barra Spaziatrice)
window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && document.activeElement !== manualInput) {
        e.preventDefault(); // Evita lo scroll della pagina
        if (!e.repeat) handlePressStart();
    }
});

window.addEventListener('keyup', (e) => {
    if (e.code === 'Space' && document.activeElement !== manualInput) {
        e.preventDefault();
        handlePressEnd();
    }
});

// Eventi Mouse / Touch sull'area del timer
timerTouchArea.addEventListener('mousedown', handlePressStart);
window.addEventListener('mouseup', () => {
    if (state === 'HOLDING' || state === 'READY') handlePressEnd();
});

// --- 3. REGISTRAZIONE TEMPI E CALCOLO STATISTICHE (PB e Ao5) ---
function recordSolve(ms) {
    let usedScramble = 'Timer Libero';
    if (currentMode === 'auto') usedScramble = currentScramble;
    if (currentMode === 'manual') usedScramble = manualInput.value.trim() || 'Manuale';

    solves.unshift({
        id: Date.now(),
        timeMs: ms,
        scramble: usedScramble
    });

    updateStatsAndList();
}

function calculateAo5() {
    if (solves.length < 5) return '-';
    // Prende gli ultimi 5 tempi, scarta il migliore e il peggiore, fa la media dei 3 centrali (regola ufficiale WCA!)
    const last5 = solves.slice(0, 5).map(s => s.timeMs).sort((a, b) => a - b);
    const middle3 = last5.slice(1, 4);
    const avgMs = middle3.reduce((acc, val) => acc + val, 0) / 3;
    return formatTime(avgMs);
}

function updateStatsAndList() {
    statCount.textContent = solves.length;

    if (solves.length === 0) {
        statLast.textContent = '-';
        statPb.textContent = '-';
        statAo5.textContent = '-';
        timesList.innerHTML = '<li class="empty-msg">Nessun tempo registrato. Fai la tua prima solve!</li>';
        return;
    }

    statLast.textContent = formatTime(solves[0].timeMs);
    const bestMs = Math.min(...solves.map(s => s.timeMs));
    statPb.textContent = formatTime(bestMs);
    statAo5.textContent = calculateAo5();

    timesList.innerHTML = solves.map((solve, idx) => `
        <li class="time-pill" title="Scramble: ${solve.scramble}">
            <span class="index">#${solves.length - idx}</span>
            <strong>${formatTime(solve.timeMs)}</strong>
        </li>
    `).join('');
}

btnClear.addEventListener('click', () => {
    solves = [];
    timerDisplay.textContent = '0.00';
    updateStatsAndList();
});

// Avvio iniziale
generateScramble();