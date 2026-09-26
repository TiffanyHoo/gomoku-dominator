/**
 * board2d.js — 五子棋 2D 棋盘（canvas 实现）
 *
 * 对外接口与 board3d.js 完全一致：
 *   Board2D.init(root, { onCellClick, onCellHover, onCellLeave })
 *   Board2D.render({ stones, hover, lastMove, interactive })
 *   Board2D.resetView()  // 2D 无视角概念，空实现
 */
(function () {
    'use strict';

    var SIZE = 15;
    var CELL = 40;                          // 交叉点间距(px)
    var PAD = 25;                           // 棋盘边距(px)
    var R = 17;                             // 棋子半径(px)
    var CANVAS = PAD * 2 + CELL * (SIZE - 1); // 610
    var LETTERS = 'ABCDEFGHIJKLMNO';

    var cv, ctx;
    var onCellClick = null, onCellHover = null, onCellLeave = null;

    // 换算鼠标位置到最近交叉点；距交叉点过远（>半格）不响应，手感与 3D 命中区一致
    function pos2rc(e) {
        var rect = cv.getBoundingClientRect();
        var mx = (e.clientX - rect.left) * (CANVAS / rect.width);
        var my = (e.clientY - rect.top) * (CANVAS / rect.height);
        var col = Math.round((mx - PAD) / CELL);
        var row = Math.round((my - PAD) / CELL);
        if (row < 0 || row >= SIZE || col < 0 || col >= SIZE) return null;
        var dx = mx - (PAD + col * CELL);
        var dy = my - (PAD + row * CELL);
        if (Math.hypot(dx, dy) > CELL / 2) return null;
        return { row: row, col: col };
    }

    function drawStone(row, col, color, ghost) {
        var x = PAD + col * CELL;
        var y = PAD + row * CELL;
        ctx.save();
        ctx.globalAlpha = ghost ? 0.4 : 1;
        var grad = ctx.createRadialGradient(x - 4, y - 4, 2, x, y, R);
        if (color === 1) {
            grad.addColorStop(0, '#666');
            grad.addColorStop(1, '#111');
        } else {
            grad.addColorStop(0, '#ffffff');
            grad.addColorStop(1, '#cccccc');
        }
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(x, y, R, 0, Math.PI * 2);
        ctx.fill();
        if (!ghost) {
            ctx.strokeStyle = color === 1 ? '#000' : '#999';
            ctx.lineWidth = 1;
            ctx.stroke();
        }
        ctx.restore();
    }

    function render(state) {
        state = state || {};
        var stones = state.stones || [];

        // 木色底 + 斜向明暗
        var bg = ctx.createLinearGradient(0, 0, CANVAS, CANVAS);
        bg.addColorStop(0, '#e2bb66');
        bg.addColorStop(0.5, '#dcb35c');
        bg.addColorStop(1, '#d3a94f');
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, CANVAS, CANVAS);

        // 棋盘线
        ctx.strokeStyle = '#8b6914';
        ctx.lineWidth = 1;
        for (var i = 0; i < SIZE; i++) {
            var p = PAD + i * CELL;
            ctx.beginPath();
            ctx.moveTo(PAD, p);
            ctx.lineTo(PAD + (SIZE - 1) * CELL, p);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(p, PAD);
            ctx.lineTo(p, PAD + (SIZE - 1) * CELL);
            ctx.stroke();
        }

        // 星位
        ctx.fillStyle = '#8b6914';
        [[3, 3], [3, 11], [7, 7], [11, 3], [11, 11]].forEach(function (s) {
            ctx.beginPath();
            ctx.arc(PAD + s[1] * CELL, PAD + s[0] * CELL, 4, 0, Math.PI * 2);
            ctx.fill();
        });

        // 坐标：左侧 15→1，底部 A→O
        ctx.font = '600 10px "Segoe UI", "Microsoft YaHei", sans-serif';
        ctx.fillStyle = 'rgba(96, 60, 22, 0.8)';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        for (var j = 0; j < SIZE; j++) {
            var q = PAD + j * CELL;
            ctx.fillText(LETTERS[j], q, CANVAS - 9);
            ctx.fillText(String(SIZE - j), 9, q);
        }

        // 棋子
        stones.forEach(function (s) { drawStone(s.row, s.col, s.color, false); });

        // 回放：最后一手红圈标记
        if (state.lastMove) {
            ctx.strokeStyle = '#e74c3c';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(PAD + state.lastMove.col * CELL, PAD + state.lastMove.row * CELL, R + 3, 0, Math.PI * 2);
            ctx.stroke();
        }

        // 悬停虚影（仅可落子时由 client 传入）
        if (state.hover) drawStone(state.hover.row, state.hover.col, state.hover.color, true);

        cv.style.cursor = state.interactive ? 'pointer' : 'default';
    }

    function init(root, opts) {
        onCellClick = opts.onCellClick;
        onCellHover = opts.onCellHover;
        onCellLeave = opts.onCellLeave;

        cv = document.createElement('canvas');
        // 按设备像素比放大画布，保证高分屏清晰；绘制坐标仍用逻辑像素
        var dpr = Math.min(window.devicePixelRatio || 1, 2);
        cv.width = CANVAS * dpr;
        cv.height = CANVAS * dpr;
        root.appendChild(cv);
        ctx = cv.getContext('2d');
        ctx.scale(dpr, dpr);

        cv.addEventListener('click', function (e) {
            var p = pos2rc(e);
            if (p && onCellClick) onCellClick(p.row, p.col);
        });
        cv.addEventListener('mousemove', function (e) {
            var p = pos2rc(e);
            if (p) {
                if (onCellHover) onCellHover(p.row, p.col);
            } else if (onCellLeave) {
                onCellLeave();
            }
        });
        cv.addEventListener('mouseleave', function () {
            if (onCellLeave) onCellLeave();
        });
    }

    function resetView() { /* 2D 无视角概念 */ }

    window.Board2D = {
        init: init,
        render: render,
        resetView: resetView
    };
})();
