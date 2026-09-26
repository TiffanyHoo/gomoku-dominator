const BOARD_SIZE = 15;

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
let undoPending = false;    // 我发起的悔棋请求正在等待对方同意

// ===== 棋盘渲染：2D（board2d.js，canvas）与 3D（board3d.js，CSS 3D）双实现，可切换 =====
const board3dRoot = document.getElementById('board3d');
const board2dRoot = document.getElementById('board2d');
let boardMode = (() => {
    try { return localStorage.getItem('gomoku_board_mode') === '2d' ? '2d' : '3d'; }
    catch (e) { return '3d'; }
})();

const boardCallbacks = {
    onCellClick: handleBoardClick,
    onCellHover: (row, col) => { hoverPos = { row, col }; drawBoard(); },
    onCellLeave: () => { hoverPos = null; drawBoard(); },
};
Board3D.init(board3dRoot, boardCallbacks);
Board2D.init(board2dRoot, boardCallbacks);
document.getElementById('btnResetView').addEventListener('click', () => Board3D.resetView());

function activeBoard() {
    return boardMode === '2d' ? Board2D : Board3D;
}

function applyBoardMode() {
    board3dRoot.style.display = boardMode === '3d' ? '' : 'none';
    board2dRoot.style.display = boardMode === '2d' ? '' : 'none';
    // 复位视角按钮与拖拽提示仅 3D 模式有意义
    document.getElementById('btnResetView').style.display = boardMode === '3d' ? '' : 'none';
    document.getElementById('boardTip').style.display = boardMode === '3d' ? '' : 'none';
    document.querySelectorAll('#boardModeSwitch .mode-btn').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.mode === boardMode);
    });
}

function setBoardMode(mode) {
    if (mode === boardMode) return;
    boardMode = mode;
    try { localStorage.setItem('gomoku_board_mode', mode); } catch (e) {}
    applyBoardMode();
    drawBoard(); // 切换后立即在当前棋盘上重绘局面
}

document.querySelectorAll('#boardModeSwitch .mode-btn').forEach((btn) => {
    btn.addEventListener('click', () => setBoardMode(btn.dataset.mode));
});
applyBoardMode();

function initBoard() {
    board = Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(0));
    gameOver = false;
    currentTurn = 1;
    hoverPos = null;
    moveHistory = [];
    viewIndex = null;
    resetUndoUI();
    drawBoard();
    updateTurnInfo();
    renderMoveList();
}

function drawBoard() {
    const stones = [];
    let lastMove = null;
    if (viewIndex === null) {
        for (let r = 0; r < BOARD_SIZE; r++) {
            for (let c = 0; c < BOARD_SIZE; c++) {
                if (board[r][c] !== 0) stones.push({ row: r, col: c, color: board[r][c] });
            }
        }
    } else {
        // 回放：只显示前 viewIndex 手，最后一手高亮标记
        for (let i = 0; i < viewIndex && i < moveHistory.length; i++) {
            const m = moveHistory[i];
            stones.push({ row: m.row, col: m.col, color: m.color });
        }
        lastMove = moveHistory[viewIndex - 1] || null;
    }
    const canHover = viewIndex === null && !gameOver && (gameMode === 'local' || currentTurn === myColor);
    const hover = canHover && hoverPos && board[hoverPos.row][hoverPos.col] === 0
        ? { row: hoverPos.row, col: hoverPos.col, color: currentTurn }
        : null;
    activeBoard().render({ stones, hover, lastMove, interactive: canHover });
}

function handleBoardClick(row, col) {
    if (gameMode === 'local') {
        if (gameOver) return;
        if (board[row][col] !== 0) return;
        placeLocalMove(row, col);
        return;
    }
    if (!es || es.readyState !== EventSource.OPEN) return;
    if (gameOver || viewIndex !== null) return; // 回放模式下不落子
    if (currentTurn !== myColor) return;
    if (board[row][col] !== 0) return;
    sendToServer({ type: 'move', row, col });
}

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
    moveHistory.push({ row, col, color: currentTurn }); // 记录棋谱，悔棋时依赖它回退
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
    renderMoveList();
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

    if (msg.type === 'undo-request') {
        if (msg.isRequester) {
            undoPending = true;
            document.getElementById('btnUndo').textContent = '撤销悔棋';
            showToast('悔棋请求已发送，等待对方同意');
        } else {
            const who = msg.requesterColor === 1 ? '黑方' : '白方';
            document.getElementById('undoText').textContent = `${who}请求悔棋，是否同意？`;
            document.getElementById('undoOverlay').style.display = '';
        }
    }

    if (msg.type === 'undo') {
        resetUndoUI();
        applyUndo();
    }

    if (msg.type === 'undo-declined') {
        resetUndoUI();
        if (msg.requesterColor === myColor) showToast('对方拒绝了悔棋');
    }

    if (msg.type === 'undo-cancelled') {
        resetUndoUI();
    }

    if (msg.type === 'leave') {
        // 对手离开：不踢回大厅，保留棋盘供复盘，用非阻挡提示条提示
        resetUndoUI();
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
        // errorMsg 位于大厅，对局中不可见，改用 toast 提示
        if (document.getElementById('game').style.display !== 'none') {
            showToast(msg.message);
        }
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

// ===== 悔棋 =====
// 本地模式：直接回退最后一手；联机模式：需对方同意后回退

function undoMove() {
    if (gameMode === 'local') {
        if (gameOver || moveHistory.length === 0) {
            showToast('没有可悔的棋');
            return;
        }
        applyUndo();
        return;
    }
    // 联机模式
    if (!es || es.readyState !== EventSource.OPEN) return;
    if (undoPending) {
        // 再次点击 = 撤销悔棋请求
        resetUndoUI();
        sendToServer({ type: 'undo-cancel' });
        return;
    }
    if (gameOver) {
        showToast('对局已结束，无法悔棋');
        return;
    }
    if (moveHistory.length === 0) {
        showToast('还没有落子，无法悔棋');
        return;
    }
    if (moveHistory[moveHistory.length - 1].color !== myColor) {
        showToast('只能悔自己刚落的那一手棋');
        return;
    }
    sendToServer({ type: 'undo-request' });
}

// 回退最后一手棋：清除棋盘与棋谱记录，轮到悔棋方重新落子
function applyUndo() {
    const last = moveHistory.pop();
    if (!last) return;
    board[last.row][last.col] = 0;
    currentTurn = last.color;
    if (viewIndex !== null) viewIndex = Math.min(viewIndex, moveHistory.length);
    drawBoard();
    renderMoveList();
    updateTurnInfo();
}

function respondUndo(accept) {
    document.getElementById('undoOverlay').style.display = 'none';
    sendToServer({ type: 'undo-respond', accept: !!accept });
}

function resetUndoUI() {
    undoPending = false;
    const btn = document.getElementById('btnUndo');
    if (btn) btn.textContent = '悔棋';
    const overlay = document.getElementById('undoOverlay');
    if (overlay) overlay.style.display = 'none';
}

function showToast(text, ms = 2000) {
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = text;
    t.style.display = '';
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => { t.style.display = 'none'; }, ms);
}

// ===== 房间号一键复制 =====

async function copyRoomId() {
    const id = currentRoomId;
    if (!id) return;
    let ok = false;
    // clipboard API 仅在安全上下文（https / localhost）可用，局域网 http 访问需降级
    if (navigator.clipboard && window.isSecureContext) {
        try { await navigator.clipboard.writeText(id); ok = true; } catch {}
    }
    if (!ok) {
        const ta = document.createElement('textarea');
        ta.value = id;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        try { ok = document.execCommand('copy'); } catch {}
        document.body.removeChild(ta);
    }
    showToast(ok ? '房间号已复制' : '复制失败，请手动复制');
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
