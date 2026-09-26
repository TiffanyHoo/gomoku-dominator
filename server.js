const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3000;
const BOARD_SIZE = 15;

const clients = new Map();      // clientId -> SSE response
const clientState = new Map();  // clientId -> { roomId, color }
const rooms = new Map();        // roomId -> { players, board, moves, turn, started, phase, pendingUndo }

function generateRoomId() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let id = '';
    for (let i = 0; i < 6; i++) {
        id += chars[Math.floor(Math.random() * chars.length)];
    }
    return id;
}

function broadcastToRoom(roomId, message) {
    const room = rooms.get(roomId);
    if (!room) return;
    const data = `data: ${JSON.stringify(message)}\n\n`;
    room.players.forEach(p => {
        const res = clients.get(p.clientId);
        if (res) res.write(data);
    });
}

function sendToClient(clientId, message) {
    const res = clients.get(clientId);
    if (res) res.write(`data: ${JSON.stringify(message)}\n\n`);
}

function resetBoard() {
    return Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(0));
}

function checkWin(board, row, col, player) {
    const directions = [[0,1],[1,0],[1,1],[1,-1]];
    for (const [dr, dc] of directions) {
        let count = 1;
        for (let i = 1; i < 5; i++) {
            const r = row + dr * i, c = col + dc * i;
            if (r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE && board[r][c] === player) count++;
            else break;
        }
        for (let i = 1; i < 5; i++) {
            const r = row - dr * i, c = col - dc * i;
            if (r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE && board[r][c] === player) count++;
            else break;
        }
        if (count >= 5) return true;
    }
    return false;
}

function handleSSE(req, res, clientId) {
    if (!clientId) {
        res.writeHead(400);
        res.end();
        return;
    }
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
    });
    clients.set(clientId, res);
    res.write(': connected\n\n');

    // 重连：恢复在线状态
    const state = clientState.get(clientId);
    if (state && state.roomId) {
        const room = rooms.get(state.roomId);
        const p = room && room.players.find(p => p.clientId === clientId);
        if (p) {
            p.connected = true;
            clearTimeout(p.cleanupTimer);
        }
    }

    // 心跳，防止代理超时断开
    const heartbeat = setInterval(() => {
        res.write(': ping\n\n');
    }, 25000);

    req.on('close', () => {
        clearInterval(heartbeat);
        if (clients.get(clientId) === res) clients.delete(clientId);
        handleDisconnect(clientId);
    });
}

function removePlayerFromRoom(state, clientId) {
    const room = rooms.get(state.roomId);
    if (!room) {
        state.roomId = null;
        return;
    }
    const p = room.players.find(p => p.clientId === clientId);
    if (!p) return;
    const wasPlaying = room.phase === 'playing';
    room.pendingUndo = null; // 有悔棋请求待处理时离开，请求随之作废
    room.players = room.players.filter(x => x !== p);
    clearTimeout(p.cleanupTimer);
    if (room.players.length === 0) {
        rooms.delete(state.roomId);
    } else {
        // 保留棋盘供留房者复盘；若正在对局中则结束本局
        if (wasPlaying) room.phase = 'ended';
        broadcastToRoom(state.roomId, { type: 'leave', color: state.color, wasPlaying });
    }
}

function handleDisconnect(clientId) {
    const state = clientState.get(clientId);
    if (!state || !state.roomId) return;
    const room = rooms.get(state.roomId);
    if (!room) {
        state.roomId = null;
        return;
    }
    const p = room.players.find(p => p.clientId === clientId);
    if (!p) return;

    // 延迟清理，给短暂断线（如自动重连）留缓冲时间
    p.connected = false;
    p.cleanupTimer = setTimeout(() => {
        if (p.connected) return;
        removePlayerFromRoom(state, clientId);
    }, 5000);
}

function handleApi(res, pathname, msg) {
    const clientId = msg.clientId;
    let state = clientState.get(clientId);
    if (!state) {
        state = { roomId: null, color: 0 };
        clientState.set(clientId, state);
    }

    const reply = (data) => {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(data));
    };

    if (pathname === '/api/create') {
        let roomId;
        do { roomId = generateRoomId(); } while (rooms.has(roomId));
        rooms.set(roomId, {
            players: [{ clientId, color: 1, connected: true }],
            board: resetBoard(),
            moves: [],          // 落子历史：[{ row, col, color }]
            turn: 1,
            started: false,
            phase: 'waiting', // 'waiting' | 'playing' | 'ended'
            pendingUndo: null,  // 悔棋请求：{ requesterId, requesterColor }
        });
        state.roomId = roomId;
        state.color = 1;
        reply({ type: 'created', roomId, color: 1 });
        return;
    }

    if (pathname === '/api/join') {
        const roomId = String(msg.roomId || '').toUpperCase();
        const room = rooms.get(roomId);
        if (!room) {
            reply({ type: 'error', message: '房间不存在！' });
            return;
        }
        if (room.players.length >= 2) {
            reply({ type: 'error', message: '房间已满！' });
            return;
        }
        // 同一客户端不能加入自己创建的房间
        if (room.players.some(p => p.clientId === clientId)) {
            reply({ type: 'error', message: '不能加入自己的房间！' });
            return;
        }
        // 分配空缺的颜色（兼容"等待新对手"时留房者为白方的情况）
        const color = room.players.some(p => p.color === 1) ? 2 : 1;
        room.players.push({ clientId, color, connected: true });
        state.roomId = roomId;
        state.color = color;
        room.started = true;
        room.phase = 'playing';
        reply({ type: 'joined', roomId, color });
        broadcastToRoom(roomId, { type: 'start', turn: 1 });
        return;
    }

    if (pathname === '/api/move') {
        const room = rooms.get(state.roomId);
        if (!room || !room.started) {
            reply({ ok: false });
            return;
        }
        if (room.turn !== state.color) {
            reply({ ok: false });
            return;
        }
        const { row, col } = msg;
        if (row < 0 || row >= BOARD_SIZE || col < 0 || col >= BOARD_SIZE || room.board[row][col] !== 0) {
            reply({ ok: false });
            return;
        }

        room.board[row][col] = state.color;
        room.moves.push({ row, col, color: state.color });
        const win = checkWin(room.board, row, col, state.color);
        room.turn = state.color === 1 ? 2 : 1;
        if (win) room.phase = 'ended';

        // 有悔棋请求待处理时落子，视为用行动拒绝了悔棋：请求自动作废
        if (room.pendingUndo) {
            room.pendingUndo = null;
            broadcastToRoom(state.roomId, { type: 'undo-cancelled' });
        }

        broadcastToRoom(state.roomId, {
            type: 'move',
            row,
            col,
            color: state.color,
            turn: room.turn,
            win: win ? state.color : 0,
        });
        reply({ ok: true });
        return;
    }

    if (pathname === '/api/undo-request') {
        const room = rooms.get(state.roomId);
        if (!room || room.phase !== 'playing') {
            reply({ type: 'error', message: '当前无法悔棋' });
            return;
        }
        if (room.moves.length === 0) {
            reply({ type: 'error', message: '还没有落子，无法悔棋' });
            return;
        }
        // 悔棋只能悔自己刚落的最后一手
        const lastMove = room.moves[room.moves.length - 1];
        if (lastMove.color !== state.color) {
            reply({ type: 'error', message: '只能悔自己刚落的那一手棋' });
            return;
        }
        if (room.pendingUndo) {
            reply({ type: 'error', message: '已有悔棋请求等待处理' });
            return;
        }
        const opponent = room.players.find(p => p.clientId !== clientId);
        if (!opponent || !opponent.connected) {
            reply({ type: 'error', message: '对手不在线，无法悔棋' });
            return;
        }
        room.pendingUndo = { requesterId: clientId, requesterColor: state.color };
        room.players.forEach(p => {
            sendToClient(p.clientId, {
                type: 'undo-request',
                requesterColor: state.color,
                isRequester: p.clientId === clientId,
            });
        });
        reply({ ok: true });
        return;
    }

    if (pathname === '/api/undo-respond') {
        const room = rooms.get(state.roomId);
        if (!room || !room.pendingUndo) {
            reply({ ok: false });
            return;
        }
        // 请求方不能处理自己的悔棋请求
        if (room.pendingUndo.requesterId === clientId) {
            reply({ ok: false });
            return;
        }
        const requesterColor = room.pendingUndo.requesterColor;
        room.pendingUndo = null;
        if (msg.accept) {
            const lastMove = room.moves.pop();
            room.board[lastMove.row][lastMove.col] = 0;
            room.turn = lastMove.color; // 悔棋后轮到悔棋方重新落子
            broadcastToRoom(state.roomId, {
                type: 'undo',
                row: lastMove.row,
                col: lastMove.col,
                color: lastMove.color,
                turn: room.turn,
            });
        } else {
            broadcastToRoom(state.roomId, { type: 'undo-declined', requesterColor });
        }
        reply({ ok: true });
        return;
    }

    if (pathname === '/api/undo-cancel') {
        const room = rooms.get(state.roomId);
        if (room && room.pendingUndo && room.pendingUndo.requesterId === clientId) {
            room.pendingUndo = null;
            broadcastToRoom(state.roomId, { type: 'undo-cancelled' });
        }
        reply({ ok: true });
        return;
    }

    if (pathname === '/api/restart') {
        const room = rooms.get(state.roomId);
        if (!room || room.players.length < 2) {
            reply({ ok: false });
            return;
        }
        room.board = resetBoard();
        room.moves = [];
        room.pendingUndo = null;
        room.turn = 1;
        room.phase = 'playing';
        broadcastToRoom(state.roomId, { type: 'restart', turn: 1 });
        reply({ ok: true });
        return;
    }

    if (pathname === '/api/wait-opponent') {
        const room = rooms.get(state.roomId);
        // 仅允许房间只剩自己时等待新对手：重置棋盘但保留房间号
        if (!room || room.players.length !== 1) {
            reply({ ok: false });
            return;
        }
        room.board = resetBoard();
        room.moves = [];
        room.pendingUndo = null;
        room.turn = 1;
        room.started = false;
        room.phase = 'waiting';
        reply({ ok: true, roomId: state.roomId, color: state.color });
        return;
    }

    if (pathname === '/api/chat') {
        if (!state.roomId) {
            reply({ ok: false });
            return;
        }
        broadcastToRoom(state.roomId, {
            type: 'chat',
            color: state.color,
            text: msg.text,
        });
        reply({ ok: true });
        return;
    }

    if (pathname === '/api/leave') {
        if (state.roomId) {
            removePlayerFromRoom(state, clientId);
        }
        state.roomId = null;
        state.color = 0;
        reply({ ok: true });
        return;
    }

    res.writeHead(404);
    res.end();
}

const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname === '/events' && req.method === 'GET') {
        handleSSE(req, res, url.searchParams.get('clientId'));
        return;
    }

    if (url.pathname.startsWith('/api/') && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            let msg = {};
            try { msg = JSON.parse(body); } catch {}
            handleApi(res, url.pathname, msg);
        });
        return;
    }

    // 用 pathname 而非 req.url：带 ?v= 版本号的静态资源才能正确命中文件
    let filePath = url.pathname === '/' ? '/index.html' : url.pathname;
    filePath = path.join(__dirname, 'public', filePath);
    const ext = path.extname(filePath);
    const contentTypes = {
        '.html': 'text/html; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.js': 'application/javascript; charset=utf-8',
    };
    const contentType = contentTypes[ext] || 'application/octet-stream';
    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(404);
            res.end('Not Found');
            return;
        }
        // 禁止缓存，避免浏览器使用旧版页面/脚本
        res.writeHead(200, {
            'Content-Type': contentType,
            'Cache-Control': 'no-cache',
        });
        res.end(data);
    });
});

server.listen(PORT, '0.0.0.0', () => {
    const interfaces = require('os').networkInterfaces();
    const addresses = [];
    Object.values(interfaces).forEach(iface => {
        iface.forEach(addr => {
            if (addr.family === 'IPv4' && !addr.internal) {
                addresses.push(addr.address);
            }
        });
    });
    console.log('========================================');
    console.log('   称霸五子棋 - 服务器已启动！');
    console.log('========================================');
    console.log(`  本机访问: http://localhost:${PORT}`);
    addresses.forEach(addr => {
        console.log(`  局域网访问: http://${addr}:${PORT}`);
    });
    console.log('========================================');
    console.log('  让朋友在浏览器打开局域网地址即可联机！');
    console.log('========================================');
});
