const BOARD_SIZE = 15;
const CELL_SIZE = 40;
const PADDING = 25;
const STONE_RADIUS = 17;
const CANVAS_SIZE = PADDING * 2 + CELL_SIZE * (BOARD_SIZE - 1);

let ws = null;
let myColor = 0;
let currentTurn = 1;
let board = [];
let gameOver = false;
let hoverPos = null;

const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
canvas.width = CANVAS_SIZE;
canvas.height = CANVAS_SIZE;

function initBoard() {
    board = Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(0));
    gameOver = false;
    currentTurn = 1;
    hoverPos = null;
    drawBoard();
    updateTurnInfo();
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

    for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
            if (board[r][c] !== 0) {
                drawStone(r, c, board[r][c]);
            }
        }
    }

    if (hoverPos && !gameOver && board[hoverPos.row][hoverPos.col] === 0 && currentTurn === myColor) {
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
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (gameOver) return;
    if (currentTurn !== myColor) return;
    const pos = getGridPos(e);
    if (!pos) return;
    if (board[pos.row][pos.col] !== 0) return;
    ws.send(JSON.stringify({ type: 'move', row: pos.row, col: pos.col }));
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

function connectWS() {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${location.host}`);

    ws.onopen = () => {};

    ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);

        if (msg.type === 'created') {
            myColor = msg.color;
            document.getElementById('displayRoomId').textContent = msg.roomId;
            document.getElementById('roomInfo').style.display = '';
            document.getElementById('waitMsg').style.display = '';
            document.getElementById('gameRoomId').textContent = msg.roomId;
        }

        if (msg.type === 'joined') {
            myColor = msg.color;
            document.getElementById('gameRoomId').textContent = msg.roomId;
            document.getElementById('errorMsg').style.display = 'none';
        }

        if (msg.type === 'start') {
            currentTurn = msg.turn;
            initBoard();
            showGame();
        }

        if (msg.type === 'move') {
            board[msg.row][msg.col] = msg.color;
            currentTurn = msg.turn;
            drawBoard();
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
            gameOver = true;
            alert('对手已离开房间');
            showLobby();
            document.getElementById('roomInfo').style.display = 'none';
            document.getElementById('errorMsg').style.display = 'none';
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
    };

    ws.onclose = () => {
        if (document.getElementById('game').style.display !== 'none') {
            alert('连接已断开');
            showLobby();
        }
    };

    ws.onerror = () => {};
}

function createRoom() {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        connectWS();
        setTimeout(() => createRoom(), 300);
        return;
    }
    ws.send(JSON.stringify({ type: 'create' }));
}

function joinRoom() {
    const roomId = document.getElementById('inputRoomId').value.trim().toUpperCase();
    if (!roomId) return;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        connectWS();
        setTimeout(() => joinRoom(), 300);
        return;
    }
    ws.send(JSON.stringify({ type: 'join', roomId }));
}

function restartGame() {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'restart' }));
    }
}

function leaveRoom() {
    if (ws) {
        ws.close();
        ws = null;
    }
    showLobby();
    document.getElementById('roomInfo').style.display = 'none';
    document.getElementById('winOverlay').style.display = 'none';
}

function showWin(winColor) {
    const overlay = document.getElementById('winOverlay');
    const text = document.getElementById('winText');
    if (winColor === myColor) {
        text.textContent = '🎉 你赢了！';
    } else {
        text.textContent = '😢 你输了！';
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
    if (!text || !ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'chat', text }));
    input.value = '';
}

document.getElementById('chatInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendChat();
});

document.getElementById('inputRoomId').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') joinRoom();
});

initBoard();
