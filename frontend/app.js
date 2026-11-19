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

// =========================================================
// 4. 3D INTERACTIVE CUBE MODAL & SOLVER (ENGLISH UI)
// =========================================================

const cubeModal = document.getElementById('cube-modal');
const btnOpenCubeModal = document.getElementById('btn-open-cube-modal');
const btnCloseModal = document.getElementById('btn-close-modal');
const cube3d = document.getElementById('cube-3d');
const cubeScene = document.getElementById('cube-scene');
const rotateArrows = document.querySelectorAll('.rotate-arrow');
const colorButtons = document.querySelectorAll('.color-btn');
const btnResetCube = document.getElementById('btn-reset-cube');
const btnGenerateSolution = document.getElementById('btn-generate-solution');
const validationMsg = document.getElementById('cube-validation-msg');
const solutionBox = document.getElementById('solution-box');
const solutionMovesText = document.getElementById('solution-moves-text');
const btnCopySolution = document.getElementById('btn-copy-solution');

let selectedColor = 'W';
let rotX = -25;
let rotY = -35;
let isDragging = false;
let startDragX = 0;
let startDragY = 0;
let solverReady = false;

// Inizializza le tabelle del risolutore in background
if (typeof Cube !== 'undefined') {
    setTimeout(() => {
        Cube.initSolver();
        solverReady = true;
    }, 100);
}

// Genera dinamicamente i 9 quadratini (sticker) per ciascuna delle 6 facce
const faceElements = document.querySelectorAll('.face');
faceElements.forEach(faceEl => {
    const faceCode = faceEl.dataset.face;
    for (let i = 0; i < 9; i++) {
        const sticker = document.createElement('div');
        sticker.className = 'sticker';
        sticker.dataset.face = faceCode;
        sticker.dataset.index = i;
        sticker.dataset.color = 'GRAY';

        sticker.addEventListener('click', (e) => {
            e.stopPropagation(); // Evita conflitti col trascinamento
            sticker.dataset.color = selectedColor;
            validateStickerCounts();
        });

        faceEl.appendChild(sticker);
    }
});

// Apertura e chiusura Modale
btnOpenCubeModal.addEventListener('click', () => {
    btnOpenCubeModal.blur();
    cubeModal.classList.remove('hidden');
});

btnCloseModal.addEventListener('click', () => {
    cubeModal.classList.add('hidden');
});

cubeModal.addEventListener('click', (e) => {
    if (e.target === cubeModal) cubeModal.classList.add('hidden');
});

// Selezione colore dalla tavolozza
colorButtons.forEach(btn => {
    btn.addEventListener('click', () => {
        colorButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        selectedColor = btn.dataset.color;
    });
});

// Aggiorna rotazione 3D del cubo
function updateCubeRotation() {
    cube3d.style.transform = `rotateX(${rotX}deg) rotateY(${rotY}deg)`;
}

// Rotazione tramite Frecce Direzionali
rotateArrows.forEach(arrow => {
    arrow.addEventListener('click', () => {
        const dir = arrow.dataset.rot;
        rotX = Math.round(rotX / 90) * 90;
        rotY = Math.round(rotY / 90) * 90;

        if (dir === 'up') rotX -= 90;
        if (dir === 'down') rotX += 90;
        if (dir === 'left') rotY += 90;
        if (dir === 'right') rotY -= 90;
        updateCubeRotation();
    });
});

// Rotazione tramite trascinamento cursore / mouse
cubeScene.addEventListener('mousedown', (e) => {
    isDragging = true;
    startDragX = e.clientX;
    startDragY = e.clientY;
    cube3d.classList.add('dragging');
});

window.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const dx = e.clientX - startDragX;
    const dy = e.clientY - startDragY;
    rotY += dx * 0.6;
    rotX -= dy * 0.6;
    startDragX = e.clientX;
    startDragY = e.clientY;
    updateCubeRotation();
});

window.addEventListener('mouseup', () => {
    if (isDragging) {
        isDragging = false;
        cube3d.classList.remove('dragging');
    }
});

// Reset tutti i quadratini a Grigio
btnResetCube.addEventListener('click', () => {
    document.querySelectorAll('.sticker').forEach(s => s.dataset.color = 'GRAY');
    solutionBox.classList.add('hidden');
    validationMsg.className = 'validation-msg';
    validationMsg.textContent = 'Cube reset. Paint all 54 stickers (9 per color).';
});

// Controllo in tempo reale del conteggio colori
function validateStickerCounts() {
    const counts = { W: 0, G: 0, R: 0, B: 0, O: 0, Y: 0, GRAY: 0 };
    document.querySelectorAll('.sticker').forEach(s => {
        counts[s.dataset.color]++;
    });

    if (counts.GRAY > 0) {
        validationMsg.className = 'validation-msg';
        validationMsg.textContent = `Remaining gray stickers: ${counts.GRAY}`;
        return false;
    }

    const colorNames = { W: 'White', G: 'Green', R: 'Red', B: 'Blue', O: 'Orange', Y: 'Yellow' };
    for (const [code, name] of Object.entries(colorNames)) {
        if (counts[code] !== 9) {
            validationMsg.className = 'validation-msg error';
            validationMsg.textContent = `Invalid count: ${name} has ${counts[code]} stickers (must be 9).`;
            return false;
        }
    }

    validationMsg.className = 'validation-msg success';
    validationMsg.textContent = 'All 54 stickers valid! Ready to generate solution.';
    return true;
}

// Calcolo dell'algoritmo di risoluzione
btnGenerateSolution.addEventListener('click', () => {
    if (!validateStickerCounts()) return;

    // I centri (indice 4 di ogni faccia) definiscono quale colore corrisponde a U, R, F, D, L, B
    const faceOrder = ['U', 'R', 'F', 'D', 'L', 'B'];
    const colorToFace = {};

    for (const f of faceOrder) {
        const centerSticker = document.querySelector(`.face-${f} .sticker[data-index="4"]`);
        const centerColor = centerSticker.dataset.color;
        if (colorToFace[centerColor]) {
            validationMsg.className = 'validation-msg error';
            validationMsg.textContent = 'Error: Each center piece (middle tile) must have a unique color.';
            return;
        }
        colorToFace[centerColor] = f;
    }

    // Costruisce la stringa di 54 caratteri nel formato URFDLB richiesto da Kociemba
    let stateString = '';
    for (const f of faceOrder) {
        const stickers = document.querySelectorAll(`.face-${f} .sticker`);
        stickers.forEach(s => {
            stateString += colorToFace[s.dataset.color];
        });
    }

    try {
        if (typeof Cube === 'undefined') {
            throw new Error('Solver library not loaded. Check your internet connection.');
        }
        if (!solverReady) {
            Cube.initSolver();
            solverReady = true;
        }
        const cubeInstance = Cube.fromString(stateString);
        const solutionMoves = cubeInstance.solve();

        solutionMovesText.textContent = solutionMoves || 'Cube is already solved!';
        solutionBox.classList.remove('hidden');
    } catch (err) {
        solutionBox.classList.add('hidden');
        validationMsg.className = 'validation-msg error';
        validationMsg.textContent = 'Impossible cube configuration! Check corner/edge colors.';
    }
});

// Copia le mosse della soluzione negli appunti
btnCopySolution.addEventListener('click', () => {
    navigator.clipboard.writeText(solutionMovesText.textContent);
    btnCopySolution.textContent = 'Copied!';
    setTimeout(() => {
        btnCopySolution.textContent = 'Copy';
    }, 1500);
});