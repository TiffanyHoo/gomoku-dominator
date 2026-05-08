const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const PORT = 3000;

const server = http.createServer((req, res) => {
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

const wss = new WebSocket.Server({ server });

const rooms = new Map();

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
    const data = JSON.stringify(message);
    room.players.forEach(p => {
        if (p.ws.readyState === WebSocket.OPEN) {
            p.ws.send(data);
        }
    });
}

function checkWin(board, row, col, player) {
    const directions = [[0,1],[1,0],[1,1],[1,-1]];
    for (const [dr, dc] of directions) {
        let count = 1;
        for (let i = 1; i < 5; i++) {
            const r = row + dr * i, c = col + dc * i;
            if (r >= 0 && r < 15 && c >= 0 && c < 15 && board[r][c] === player) count++;
            else break;
        }
        for (let i = 1; i < 5; i++) {
            const r = row - dr * i, c = col - dc * i;
            if (r >= 0 && r < 15 && c >= 0 && c < 15 && board[r][c] === player) count++;
            else break;
        }
        if (count >= 5) return true;
    }
    return false;
}

wss.on('connection', (ws) => {
    let currentRoom = null;
    let playerColor = null;

    ws.on('message', (raw) => {
        let msg;
        try {
            msg = JSON.parse(raw);
        } catch { return; }

        if (msg.type === 'create') {
            let roomId;
            do { roomId = generateRoomId(); } while (rooms.has(roomId));
            const board = Array.from({ length: 15 }, () => Array(15).fill(0));
            rooms.set(roomId, {
                players: [{ ws, color: 1 }],
                board,
                turn: 1,
                started: false,
            });
            currentRoom = roomId;
            playerColor = 1;
            ws.send(JSON.stringify({ type: 'created', roomId, color: 1 }));
        }

        if (msg.type === 'join') {
            const roomId = msg.roomId.toUpperCase();
            const room = rooms.get(roomId);
            if (!room) {
                ws.send(JSON.stringify({ type: 'error', message: '房间不存在！' }));
                return;
            }
            if (room.players.length >= 2) {
                ws.send(JSON.stringify({ type: 'error', message: '房间已满！' }));
                return;
            }
            room.players.push({ ws, color: 2 });
            currentRoom = roomId;
            playerColor = 2;
            room.started = true;
            ws.send(JSON.stringify({ type: 'joined', roomId, color: 2 }));
            broadcastToRoom(roomId, { type: 'start', turn: 1 });
        }

        if (msg.type === 'move') {
            const room = rooms.get(currentRoom);
            if (!room || !room.started) return;
            if (room.turn !== playerColor) return;
            const { row, col } = msg;
            if (row < 0 || row >= 15 || col < 0 || col >= 15) return;
            if (room.board[row][col] !== 0) return;

            room.board[row][col] = playerColor;
            const win = checkWin(room.board, row, col, playerColor);
            room.turn = playerColor === 1 ? 2 : 1;

            broadcastToRoom(currentRoom, {
                type: 'move',
                row,
                col,
                color: playerColor,
                turn: room.turn,
                win: win ? playerColor : 0,
            });
        }

        if (msg.type === 'restart') {
            const room = rooms.get(currentRoom);
            if (!room) return;
            room.board = Array.from({ length: 15 }, () => Array(15).fill(0));
            room.turn = 1;
            broadcastToRoom(currentRoom, { type: 'restart', turn: 1 });
        }

        if (msg.type === 'chat') {
            if (!currentRoom) return;
            broadcastToRoom(currentRoom, {
                type: 'chat',
                color: playerColor,
                text: msg.text,
            });
        }
    });

    ws.on('close', () => {
        if (!currentRoom) return;
        const room = rooms.get(currentRoom);
        if (!room) return;
        room.players = room.players.filter(p => p.ws !== ws);
        if (room.players.length === 0) {
            rooms.delete(currentRoom);
        } else {
            broadcastToRoom(currentRoom, { type: 'leave', color: playerColor });
            room.started = false;
            room.board = Array.from({ length: 15 }, () => Array(15).fill(0));
        }
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
