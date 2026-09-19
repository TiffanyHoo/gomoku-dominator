const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3000;
const BOARD_SIZE = 15;

const clients = new Map();      // clientId -> SSE response
const clientState = new Map();  // clientId -> { roomId, color }
const rooms = new Map();        // roomId -> { players, board, turn, started }

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
        room.players = room.players.filter(x => x !== p);
        if (room.players.length === 0) {
            rooms.delete(state.roomId);
        } else {
            broadcastToRoom(state.roomId, { type: 'leave', color: state.color });
            room.started = false;
            room.board = resetBoard();
            room.turn = 1;
        }
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
            turn: 1,
            started: false,
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
        room.players.push({ clientId, color: 2, connected: true });
        state.roomId = roomId;
        state.color = 2;
        room.started = true;
        reply({ type: 'joined', roomId, color: 2 });
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
        const win = checkWin(room.board, row, col, state.color);
        room.turn = state.color === 1 ? 2 : 1;

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

    if (pathname === '/api/restart') {
        const room = rooms.get(state.roomId);
        if (!room) {
            reply({ ok: false });
            return;
        }
        room.board = resetBoard();
        room.turn = 1;
        broadcastToRoom(state.roomId, { type: 'restart', turn: 1 });
        reply({ ok: true });
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
        const room = rooms.get(state.roomId);
        if (room) {
            room.players = room.players.filter(p => p.clientId !== clientId);
            if (room.players.length === 0) {
                rooms.delete(state.roomId);
            } else {
                broadcastToRoom(state.roomId, { type: 'leave', color: state.color });
                room.started = false;
                room.board = resetBoard();
                room.turn = 1;
            }
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

    let filePath = req.url === '/' ? '/index.html' : req.url;
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
        res.writeHead(200, { 'Content-Type': contentType });
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
