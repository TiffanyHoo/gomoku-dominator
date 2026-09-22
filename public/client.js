const BOARD_SIZE = 15;
const CELL_SIZE = 40;
const PADDING = 25;
const STONE_RADIUS = 17;
const CANVAS_SIZE = PADDING * 2 + CELL_SIZE * (BOARD_SIZE - 1);

let es = null;
const clientId = crypto.randomUUID ? crypto.randomUUID()
    : 'id-' + Date.now() + '-' + Math.random().toString(36).slice(2);
let myColor = 0;
let currentTurn = 1;
let board = [];
let gameOver = false;
let hoverPos = null;
let gameMode = 'online'; // 'online' | 'local'
let currentRoomId = null;   // 当前联机房间号
let moveHistory = [];       // 棋谱：[{ row, col, color }]
let viewIndex = null;       // null = 实时/终局局面；k = 回放到第 k 手

const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
canvas.width = CANVAS_SIZE;
canvas.height = CANVAS_SIZE;

function initBoard() {
    board = Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(0));
    gameOver = false;
    currentTurn = 1;
    hoverPos = null;
    moveHistory = [];
    viewIndex = null;
    drawBoard();
    updateTurnInfo();
    renderMoveList();
}

function drawBoard() {
    ctx.fillStyle = '#dcb35c';
    ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

    ctx.strokeStyle = '#8b6914';
    ctx.lineWidth = 1;
    for (let i = 0; i < BOARD_SIZE; i++) {
        const pos = PADDING + i * CELL_SIZE;
        ctx.beginPath();
        ctx.moveTo(PADDING, pos);
        ctx.lineTo(PADDING + (BOARD_SIZE - 1) * CELL_SIZE, pos);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(pos, PADDING);
        ctx.lineTo(pos, PADDING + (BOARD_SIZE - 1) * CELL_SIZE);
        ctx.stroke();
    }

    const starPoints = [[3,3],[3,11],[7,7],[11,3],[11,11]];
    for (const [r, c] of starPoints) {
        ctx.beginPath();
        ctx.arc(PADDING + c * CELL_SIZE, PADDING + r * CELL_SIZE, 4, 0, Math.PI * 2);
        ctx.fillStyle = '#8b6914';
        ctx.fill();
    }

    if (viewIndex === null) {
        for (let r = 0; r < BOARD_SIZE; r++) {
            for (let c = 0; c < BOARD_SIZE; c++) {
                if (board[r][c] !== 0) {
                    drawStone(r, c, board[r][c]);
                }
            }
        }
    } else {
        // 回放：只绘制前 viewIndex 手，最后一手高亮标记
        for (let i = 0; i < viewIndex && i < moveHistory.length; i++) {
            const m = moveHistory[i];
            drawStone(m.row, m.col, m.color);
            if (i === viewIndex - 1) {
                const x = PADDING + m.col * CELL_SIZE;
                const y = PADDING + m.row * CELL_SIZE;
                ctx.strokeStyle = '#e74c3c';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.arc(x, y, STONE_RADIUS + 3, 0, Math.PI * 2);
                ctx.stroke();
            }
        }
    }

    if (hoverPos && viewIndex === null && !gameOver && board[hoverPos.row][hoverPos.col] === 0 && (gameMode === 'local' || currentTurn === myColor)) {
        drawStone(hoverPos.row, hoverPos.col, currentTurn, true);
    }
}

function drawStone(row, col, color, ghost) {
    const x = PADDING + col * CELL_SIZE;
    const y = PADDING + row * CELL_SIZE;
    const alpha = ghost ? 0.4 : 1;

    ctx.save();
    ctx.globalAlpha = alpha;

    if (color === 1) {
        const grad = ctx.createRadialGradient(x - 4, y - 4, 2, x, y, STONE_RADIUS);
        grad.addColorStop(0, '#666');
        grad.addColorStop(1, '#111');
        ctx.fillStyle = grad;
    } else {
        const grad = ctx.createRadialGradient(x - 4, y - 4, 2, x, y, STONE_RADIUS);
        grad.addColorStop(0, '#ffffff');
        grad.addColorStop(1, '#cccccc');
        ctx.fillStyle = grad;
    }

    ctx.beginPath();
    ctx.arc(x, y, STONE_RADIUS, 0, Math.PI * 2);
    ctx.fill();

    if (!ghost) {
        ctx.strokeStyle = color === 1 ? '#000' : '#999';
        ctx.lineWidth = 1;
        ctx.stroke();
    }

    ctx.restore();
}

function getGridPos(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const mx = (e.clientX - rect.left) * scaleX;
    const my = (e.clientY - rect.top) * scaleY;
    const col = Math.round((mx - PADDING) / CELL_SIZE);
    const row = Math.round((my - PADDING) / CELL_SIZE);
    if (row >= 0 && row < BOARD_SIZE && col >= 0 && col < BOARD_SIZE) {
        return { row, col };
    }
    return null;
}

canvas.addEventListener('mousemove', (e) => {
    const pos = getGridPos(e);
    hoverPos = pos;
    drawBoard();
});

canvas.addEventListener('mouseleave', () => {
    hoverPos = null;
    drawBoard();
});

canvas.addEventListener('click', (e) => {
    const pos = getGridPos(e);
    if (!pos) return;
    if (gameMode === 'local') {
        if (gameOver) return;
        if (board[pos.row][pos.col] !== 0) return;
        placeLocalMove(pos.row, pos.col);
        return;
    }
    if (!es || es.readyState !== EventSource.OPEN) return;
    if (gameOver || viewIndex !== null) return; // 回放模式下不落子
    if (currentTurn !== myColor) return;
    if (board[pos.row][pos.col] !== 0) return;
    sendToServer({ type: 'move', row: pos.row, col: pos.col });
});

function updateTurnInfo() {
    const turnInfo = document.getElementById('turnInfo');
    const blackInd = document.getElementById('blackIndicator');
    const whiteInd = document.getElementById('whiteIndicator');
    if (currentTurn === 1) {
        turnInfo.textContent = '黑方落子';
        blackInd.classList.add('active');
        whiteInd.classList.remove('active');
    } else {
        turnInfo.textContent = '白方落子';
        whiteInd.classList.add('active');
        blackInd.classList.remove('active');
    }
    if (gameOver) {
        blackInd.classList.remove('active');
        whiteInd.classList.remove('active');
    }
}

function showLobby() {
    document.getElementById('lobby').style.display = '';
    document.getElementById('game').style.display = 'none';
}

function showGame() {
    document.getElementById('lobby').style.display = 'none';
    document.getElementById('game').style.display = '';
}

function hideNotice() {
    document.getElementById('noticeBar').style.display = 'none';
}

// ===== 本地模式（同屏双人对战）=====

function startLocalGame() {
    gameMode = 'local';
    initBoard();
    showGame();
    hideNotice();
    document.getElementById('roomLabel').style.display = 'none';
    document.getElementById('chatArea').style.display = 'none';
    document.getElementById('movePanel').style.display = 'none';
    document.getElementById('winOverlay').style.display = 'none';
}

function placeLocalMove(row, col) {
    board[row][col] = currentTurn;
    hoverPos = null;
    if (checkWin(row, col, currentTurn)) {
        gameOver = true;
        drawBoard();
        updateTurnInfo();
        showWin(currentTurn);
        return;
    }
    currentTurn = currentTurn === 1 ? 2 : 1;
    drawBoard();
    updateTurnInfo();
}

function checkWin(row, col, color) {
    const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
    for (const [dr, dc] of dirs) {
        let count = 1;
        for (const sign of [1, -1]) {
            let r = row + dr * sign;
            let c = col + dc * sign;
            while (r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE && board[r][c] === color) {
                count++;
                r += dr * sign;
                c += dc * sign;
            }
        }
        if (count >= 5) return true;
    }
    return false;
}

function connectSSE() {
    if (es && es.readyState !== EventSource.CLOSED) return;
    es = new EventSource(`/events?clientId=${encodeURIComponent(clientId)}`);

    es.onmessage = (e) => {
        handleMessage(JSON.parse(e.data));
    };

    // EventSource 断线后会自动重连，无需额外处理
    es.onerror = () => {};
}

function handleMessage(msg) {
    if (msg.type === 'created') {
        myColor = msg.color;
        currentRoomId = msg.roomId;
        initBoard(); // 清空上一局的棋谱与回放状态
        document.getElementById('displayRoomId').textContent = msg.roomId;
        document.getElementById('roomInfo').style.display = '';
        document.getElementById('waitMsg').style.display = '';
        document.getElementById('gameRoomId').textContent = msg.roomId;
    }

    if (msg.type === 'joined') {
        myColor = msg.color;
        currentRoomId = msg.roomId;
        initBoard(); // 清空上一局的棋谱与回放状态
        document.getElementById('gameRoomId').textContent = msg.roomId;
        document.getElementById('errorMsg').style.display = 'none';
    }

    if (msg.type === 'start') {
        gameMode = 'online';
        document.getElementById('roomLabel').style.display = '';
        document.getElementById('chatArea').style.display = '';
        document.getElementById('movePanel').style.display = '';
        hideNotice();
        currentTurn = msg.turn;
        initBoard();
        showGame();
    }

    if (msg.type === 'move') {
        moveHistory.push({ row: msg.row, col: msg.col, color: msg.color });
        board[msg.row][msg.col] = msg.color;
        currentTurn = msg.turn;
        if (viewIndex === null) drawBoard();
        renderMoveList();
        updateTurnInfo();
        if (msg.win) {
            gameOver = true;
            updateTurnInfo();
            showWin(msg.win);
        }
    }

    if (msg.type === 'restart') {
        initBoard();
        document.getElementById('winOverlay').style.display = 'none';
    }

    if (msg.type === 'leave') {
        // 对手离开：不踢回大厅，保留棋盘供复盘，用非阻挡提示条提示
        if (msg.wasPlaying) {
            gameOver = true;
            updateTurnInfo();
        }
        document.getElementById('winOverlay').style.display = 'none';
        document.getElementById('noticeText').textContent = msg.wasPlaying
            ? '对手已离开，本局未结束，可复盘棋局'
            : '对手已离开房间，可复盘棋局';
        document.getElementById('noticeBar').style.display = '';
    }

    if (msg.type === 'chat') {
        addChatMessage(msg.color, msg.text);
    }

    if (msg.type === 'error') {
        const errEl = document.getElementById('errorMsg');
        errEl.textContent = msg.message;
        errEl.style.display = '';
        setTimeout(() => { errEl.style.display = 'none'; }, 3000);
    }
}

async function sendToServer(msg) {
    msg.clientId = clientId;
    try {
        const res = await fetch(`/api/${msg.type}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(msg),
        });
        const data = await res.json();
        // created/joined/error 随 POST 响应即时返回；start/move 等通过 SSE 广播
        if (data && (data.type === 'created' || data.type === 'joined' || data.type === 'error')) {
            handleMessage(data);
        }
    } catch {}
}

function showServerError() {
    const errEl = document.getElementById('errorMsg');
    errEl.textContent = '无法连接到服务器：联机模式需要 Node 后端支持，请使用「本地对战（同屏）」';
    errEl.style.display = '';
    setTimeout(() => { errEl.style.display = 'none'; }, 5000);
}

function waitForSSE(callback, retries = 5) {
    if (es && es.readyState === EventSource.OPEN) {
        callback();
        return;
    }
    if (retries <= 0) {
        showServerError();
        return;
    }
    setTimeout(() => waitForSSE(callback, retries - 1), 300);
}

function createRoom() {
    connectSSE();
    waitForSSE(() => sendToServer({ type: 'create' }));
}

function joinRoom() {
    const roomId = document.getElementById('inputRoomId').value.trim().toUpperCase();
    if (!roomId) return;
    connectSSE();
    waitForSSE(() => sendToServer({ type: 'join', roomId }));
}

function restartGame() {
    if (gameMode === 'local') {
        initBoard();
        document.getElementById('winOverlay').style.display = 'none';
        return;
    }
    if (es && es.readyState === EventSource.OPEN) {
        sendToServer({ type: 'restart' });
    }
}

function leaveRoom() {
    if (es && es.readyState === EventSource.OPEN) {
        sendToServer({ type: 'leave' });
    }
    currentRoomId = null;
    initBoard(); // 清空棋盘与棋谱，避免残留到下一局
    hideNotice();
    showLobby();
    document.getElementById('roomInfo').style.display = 'none';
    document.getElementById('winOverlay').style.display = 'none';
}

function hideWinOverlay() {
    document.getElementById('winOverlay').style.display = 'none';
}

// ===== 棋谱回放 =====

function coordLabel(row, col) {
    const letters = 'ABCDEFGHIJKLMNO';
    return `${letters[col]}${BOARD_SIZE - row}`;
}

function renderMoveList() {
    const container = document.getElementById('moveList');
    if (!container) return;
    container.innerHTML = '';
    moveHistory.forEach((m, i) => {
        const div = document.createElement('div');
        div.className = 'move-item' + (viewIndex === i + 1 ? ' active' : '');
        div.textContent = `第${i + 1}手  ${m.color === 1 ? '⚫ 黑' : '⚪ 白'}  ${coordLabel(m.row, m.col)}`;
        div.addEventListener('click', () => replayTo(i + 1));
        container.appendChild(div);
    });
    if (viewIndex === null) {
        container.scrollTop = container.scrollHeight; // 实时/终局：跟随最新一手
    } else {
        // 回放：选中项滚动到列表中间，不强制滚到底部
        const active = container.children[viewIndex - 1];
        if (active) {
            const cRect = container.getBoundingClientRect();
            const aRect = active.getBoundingClientRect();
            const delta = (aRect.top + aRect.height / 2) - (cRect.top + cRect.height / 2);
            container.scrollTop += delta;
        }
    }
}

function replayTo(k) {
    if (k < 1 || k > moveHistory.length) return;
    viewIndex = (viewIndex === k) ? null : k; // 再次点击同一手回到实时局面
    drawBoard();
    renderMoveList();
}

function backToLive() {
    viewIndex = null;
    drawBoard();
    renderMoveList();
}

// ===== 等待新对手（保留房间号）=====

async function waitForOpponent() {
    hideNotice();
    if (es && es.readyState === EventSource.OPEN && currentRoomId) {
        await sendToServer({ type: 'wait-opponent' });
    }
    initBoard();
    showLobby();
    document.getElementById('displayRoomId').textContent = currentRoomId || '';
    document.getElementById('roomInfo').style.display = '';
    document.getElementById('waitMsg').style.display = '';
}

function showWin(winColor) {
    const overlay = document.getElementById('winOverlay');
    const text = document.getElementById('winText');
    if (gameMode === 'local') {
        text.textContent = winColor === 1 ? '🎉 黑方获胜！' : '🎉 白方获胜！';
    } else {
        if (winColor === myColor) {
            text.textContent = '🎉 你赢了！';
        } else {
            text.textContent = '😢 你输了！';
        }
    }
    overlay.style.display = '';
}

function addChatMessage(color, text) {
    const container = document.getElementById('chatMessages');
    const div = document.createElement('div');
    div.className = 'chat-msg';
    const sender = color === 1 ? '黑方' : '白方';
    const senderClass = color === 1 ? 'black-sender' : 'white-sender';
    div.innerHTML = `<span class="sender ${senderClass}">${sender}：</span>${escapeHtml(text)}`;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function sendChat() {
    const input = document.getElementById('chatInput');
    const text = input.value.trim();
    if (!text || !es || es.readyState !== EventSource.OPEN) return;
    sendToServer({ type: 'chat', text });
    input.value = '';
}

document.getElementById('chatInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendChat();
});

document.getElementById('inputRoomId').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') joinRoom();
});

initBoard();
