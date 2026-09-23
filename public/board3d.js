/**
 * board3d.js — 五子棋 3D 棋盘（纯 CSS 3D 实现，无外部依赖）
 *
 * 结构：
 *   .board3d（透视场景）
 *     └─ .stage（可旋转/缩放的世界，rotateX 俯视 + rotateZ 转盘）
 *          ├─ 棋盘六面（顶面/底面/四个侧面，木纹贴图由 canvas 程序化生成）
 *          └─ 顶面之上：棋盘线、星位、坐标、命中区、棋子（球面渐变 + 投影）
 *
 * 交互：拖拽旋转 · 滚轮/双指缩放 · 双击复位 · 交叉点点击落子（悬停虚影）
 */
(function () {
    'use strict';

    var SIZE = 15;
    var CELL = 40;                 // 交叉点间距(px)
    var SPAN = CELL * (SIZE - 1);  // 棋盘线总跨度(px)
    var FACE = 656;                // 棋盘面边长(px)
    var HALF = FACE / 2;
    var THICK = 24;                // 棋盘厚度(px)
    var STONE_D = 36;              // 棋子直径(px)
    var STONE_H = 13;              // 棋子总高(px)，约为直径 1/3，扁圆双凸（云子造型）
    var SLICE_N = 16;              // 球面分层数（越多越光滑，层间条纹越不可见）
    var LETTERS = 'ABCDEFGHIJKLMNO';

    var DEF_RX = 52;               // 默认俯视角(deg)
    var RX_MIN = 15, RX_MAX = 82;
    var SCALE_MIN = 0.5, SCALE_MAX = 1.8;

    var scene, surface, stage;
    var stoneEls = new Map();      // "row:col" -> 棋子元素
    var ghost = null, ring = null;
    var onCellClick = null, onCellHover = null, onCellLeave = null;

    // 视角：目标值 + 当前值（rAF 平滑过渡）
    var tRx = DEF_RX, tRz = 0, tScale = 1;
    var cRx = DEF_RX, cRz = 0, cScale = 1;

    function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }

    function el(tag, cls, parent) {
        var e = document.createElement(tag);
        if (cls) e.className = cls;
        if (parent) parent.appendChild(e);
        return e;
    }

    /* ================= 程序化木纹贴图 ================= */

    var seed = 987654321;
    function rnd() { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; }

    // 生成横向木纹 dataURL：base 底色，grainColor 中含 'A' 占位符替换为透明度
    function woodDataURL(base, grainColor, lightAlpha, darkAlpha, w, h) {
        var cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        var g = cv.getContext('2d');
        g.fillStyle = base;
        g.fillRect(0, 0, w, h);

        // 整体明暗：左上受光、右下压深
        var grd = g.createLinearGradient(0, 0, w, h);
        grd.addColorStop(0, 'rgba(255,240,205,' + lightAlpha + ')');
        grd.addColorStop(0.55, 'rgba(0,0,0,0)');
        grd.addColorStop(1, 'rgba(50,26,0,' + darkAlpha + ')');
        g.fillStyle = grd;
        g.fillRect(0, 0, w, h);

        // 木纤维（正弦波动的细纹）
        var i, x, y;
        for (i = 0; i < 150; i++) {
            var y0 = rnd() * h;
            var amp = 2 + rnd() * 6;
            var freq = 0.004 + rnd() * 0.012;
            var phase = rnd() * Math.PI * 2;
            g.strokeStyle = grainColor.replace('A', (0.04 + rnd() * 0.10).toFixed(3));
            g.lineWidth = (0.6 + rnd() * 2.4).toFixed(1);
            g.beginPath();
            for (x = 0; x <= w; x += 8) {
                y = y0 + Math.sin(x * freq + phase) * amp
                      + Math.sin(x * freq * 2.7 + phase * 1.7) * amp * 0.3;
                if (x === 0) g.moveTo(x, y); else g.lineTo(x, y);
            }
            g.stroke();
        }

        // 节疤弧线
        for (i = 0; i < 6; i++) {
            var cx0 = rnd() * w, cy0 = rnd() * h, r0 = 30 + rnd() * 80;
            g.strokeStyle = grainColor.replace('A', (0.08 + rnd() * 0.08).toFixed(3));
            g.lineWidth = (1.5 + rnd() * 3).toFixed(1);
            g.beginPath();
            for (var a = 0; a <= Math.PI; a += 0.08) {
                var rr = r0 * (0.9 + 0.25 * Math.sin(a * 3 + cx0));
                var px = cx0 + Math.cos(a) * rr;
                var py = cy0 + Math.sin(a) * rr * 0.55;
                if (a === 0) g.moveTo(px, py); else g.lineTo(px, py);
            }
            g.stroke();
        }
        return cv.toDataURL('image/png');
    }

    /* ================= 场景搭建 ================= */

    // 把节点放到交叉点 (row,col) 所在的棋盘面坐标（相对顶面中心）
    function place(node, row, col, z) {
        node.style.transform = 'translate(' + ((col - (SIZE - 1) / 2) * CELL) + 'px, ' +
            ((row - (SIZE - 1) / 2) * CELL) + 'px) translateZ(' + (z == null ? 1 : z) + 'px)';
    }

    /* ================= 立体棋子（球面切片堆叠） ================= */

    var STONE_PALETTE = {
        1: { hi: '#9a9aa2', mid: '#2b2b30', lo: '#07070a', spec: 'rgba(255,255,255,0.9)' },
        2: { hi: '#ffffff', mid: '#e9e6df', lo: '#a49d93', spec: 'rgba(255,255,255,0.95)' }
    };

    // 十六进制颜色乘亮度系数
    function shade(hex, f) {
        var n = parseInt(hex.slice(1), 16);
        var r = clamp(Math.round(((n >> 16) & 255) * f), 0, 255);
        var g = clamp(Math.round(((n >> 8) & 255) * f), 0, 255);
        var b = clamp(Math.round((n & 255) * f), 0, 255);
        return 'rgb(' + r + ',' + g + ',' + b + ')';
    }

    // 球面棋子：按球体剖面 r = R*sqrt(1-u²) 半径逐层收拢 + translateZ 抬高，
    // 每片一层线性渐变（左上来光），顶层叠加高光；底部附接触阴影
    function buildStone(color) {
        var R = STONE_D / 2;
        var pal = STONE_PALETTE[color] || STONE_PALETTE[1];
        var st = el('div', 'stone ' + (color === 1 ? 'black' : 'white'));
        el('div', 'stone-shadow', st);
        var lift = el('div', 'stone-lift', st);
        for (var i = 0; i < SLICE_N; i++) {
            var t = i / (SLICE_N - 1);          // 0=底层 → 1=顶层
            var u = (2 * t - 1) * 0.92;         // 球面参数，略微内收避免边缘过尖
            var r = R * Math.sqrt(Math.max(0.04, 1 - u * u));
            var z = 0.4 + t * STONE_H;
            var ao = 0.55 + 0.45 * t;           // 越靠近顶部越亮
            var slice = el('div', 'slice', lift);
            var d = (r * 2).toFixed(1) + 'px';
            slice.style.width = d;
            slice.style.height = d;
            slice.style.margin = (-r).toFixed(1) + 'px 0 0 ' + (-r).toFixed(1) + 'px';
            slice.style.transform = 'translateZ(' + z.toFixed(1) + 'px)';
            var bg = 'linear-gradient(115deg, ' + shade(pal.hi, ao) + ' 0%, ' +
                shade(pal.mid, ao) + ' 45%, ' +
                shade(pal.lo, Math.max(0.25, ao - 0.15)) + ' 100%)';
            if (i === SLICE_N - 1) {
                // 顶层：左上高光点
                bg += ', radial-gradient(closest-side at 33% 27%, ' + pal.spec +
                    ' 0%, rgba(255,255,255,0.30) 30%, rgba(255,255,255,0) 62%)';
            }
            slice.style.background = bg;
        }
        return st;
    }

    function buildGrid(top) {
        var i, r, c;

        // 棋盘线：15 横 + 15 竖
        for (i = 0; i < SIZE; i++) {
            var off = (i - (SIZE - 1) / 2) * CELL;
            var h = el('div', 'grid-line h', top);
            h.style.transform = 'translateY(' + off + 'px) translateZ(0.3px)';
            var v = el('div', 'grid-line v', top);
            v.style.transform = 'translateX(' + off + 'px) translateZ(0.3px)';
        }

        // 星位
        [[3, 3], [3, 11], [7, 7], [11, 3], [11, 11]].forEach(function (s) {
            place(el('div', 'star-point', top), s[0], s[1], 0.35);
        });

        // 坐标：左侧 15→1，下方 A→O
        for (r = 0; r < SIZE; r++) {
            var lab = el('div', 'coord', top);
            lab.textContent = SIZE - r;
            lab.style.transform = 'translate(' + (-SPAN / 2 - 26) + 'px, ' + ((r - 7) * CELL) +
                'px) translate(-50%,-50%) translateZ(0.3px)';
        }
        for (c = 0; c < SIZE; c++) {
            var lc = el('div', 'coord', top);
            lc.textContent = LETTERS[c];
            lc.style.transform = 'translate(' + ((c - 7) * CELL) + 'px, ' + (SPAN / 2 + 28) +
                'px) translate(-50%,-50%) translateZ(0.3px)';
        }

        // 交叉点命中区（透明圆，承担点击/悬停）
        for (r = 0; r < SIZE; r++) {
            for (c = 0; c < SIZE; c++) {
                var hit = el('div', 'hitarea', top);
                hit.dataset.row = r;
                hit.dataset.col = c;
                hit.style.transform = 'translate(' + ((c - 7) * CELL) + 'px, ' + ((r - 7) * CELL) +
                    'px) translateZ(0.12px)';
            }
        }
    }

    function buildScene() {
        seed = 987654321; // 固定种子，保证每次刷新木纹一致
        scene.style.setProperty('--wood-top', 'url(' + woodDataURL('#e7c28b', 'rgba(120,72,20,A)', '0.22', '0.14', 512, 512) + ')');
        scene.style.setProperty('--wood-side', 'url(' + woodDataURL('#c39a63', 'rgba(88,52,14,A)', '0.16', '0.22', 256, 128) + ')');
        scene.style.setProperty('--wood-bottom', 'url(' + woodDataURL('#a87c4b', 'rgba(70,40,10,A)', '0.10', '0.26', 256, 256) + ')');

        stage = el('div', 'stage', scene);

        // 桌面投影（随棋盘倾斜，作为接地阴影）
        var shadow = el('div', 'floor-shadow', stage);
        shadow.style.transform = 'translateZ(-14px)';

        // 棋盘六面
        el('div', 'face face-bottom', stage);
        var back = el('div', 'face face-side face-back', stage);
        back.style.transform = 'translateY(' + (-HALF) + 'px) rotateX(90deg)';
        var front = el('div', 'face face-side face-front', stage);
        front.style.transform = 'translateY(' + HALF + 'px) rotateX(-90deg)';
        var left = el('div', 'face face-side face-left', stage);
        left.style.transform = 'translateX(' + (-HALF) + 'px) rotateY(-90deg)';
        var right = el('div', 'face face-side face-right', stage);
        right.style.transform = 'translateX(' + HALF + 'px) rotateY(90deg)';

        var top = el('div', 'face face-top', stage);
        top.style.transform = 'translateZ(' + (THICK / 2) + 'px)';
        surface = top;
        buildGrid(top);
    }

    /* ================= 渲染（差量更新） ================= */

    function render(state) {
        state = state || {};
        var stones = state.stones || [];
        var seen = Object.create(null);

        stones.forEach(function (s) {
            var key = s.row + ':' + s.col;
            seen[key] = true;
            if (stoneEls.has(key)) return;
            var st = buildStone(s.color);
            surface.appendChild(st);
            var lift = st.querySelector('.stone-lift');
            lift.addEventListener('animationend', function () { lift.classList.remove('dropping'); });
            place(st, s.row, s.col, 0);
            stoneEls.set(key, st);
            // 下一帧加动画类，确保过渡触发
            requestAnimationFrame(function () { lift.classList.add('dropping'); });
        });
        stoneEls.forEach(function (st, key) {
            if (!seen[key]) { st.remove(); stoneEls.delete(key); }
        });

        // 悬停虚影（仅可落子时显示）
        var hv = state.hover;
        if (hv && state.interactive) {
            if (!ghost) {
                ghost = buildStone(hv.color);
                surface.appendChild(ghost);
            }
            ghost.style.display = '';
            ghost.className = 'stone ghost ' + (hv.color === 1 ? 'black' : 'white');
            place(ghost, hv.row, hv.col, 0);
        } else if (ghost) {
            ghost.style.display = 'none';
        }

        // 回放：最后一手红圈标记
        var lm = state.lastMove;
        if (lm) {
            if (!ring) ring = el('div', 'last-ring', surface);
            ring.style.display = '';
            place(ring, lm.row, lm.col, 15.5);
        } else if (ring) {
            ring.style.display = 'none';
        }

        scene.classList.toggle('interactive', !!state.interactive);
    }

    /* ================= 视角交互 ================= */

    function bindEvents() {
        var pointers = new Map();
        var dragMoved = false, startX = 0, startY = 0, startRx = 0, startRz = 0;
        var pinchStart = 0, scaleStart = 1;

        scene.addEventListener('pointerdown', function (e) {
            scene.setPointerCapture(e.pointerId);
            pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
            if (pointers.size === 1) {
                dragMoved = false;
                startX = e.clientX; startY = e.clientY;
                startRx = tRx; startRz = tRz;
            } else if (pointers.size === 2) {
                var pts = Array.from(pointers.values());
                pinchStart = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
                scaleStart = tScale;
            }
        });

        scene.addEventListener('pointermove', function (e) {
            if (!pointers.has(e.pointerId)) return;
            pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
            if (pointers.size === 1) {
                var dx = e.clientX - startX, dy = e.clientY - startY;
                if (Math.abs(dx) + Math.abs(dy) > 6) dragMoved = true;
                tRz = startRz - dx * 0.4; // 水平右拖：近边跟随向右（rotateZ 减小）
                tRx = clamp(startRx - dy * 0.35, RX_MIN, RX_MAX);
                kick();
            } else if (pointers.size === 2) {
                var pts = Array.from(pointers.values());
                var d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
                if (pinchStart > 0) { tScale = clamp(scaleStart * d / pinchStart, SCALE_MIN, SCALE_MAX); kick(); }
            }
        });

        function endPointer(e) {
            var wasSingle = pointers.size === 1;
            pointers.delete(e.pointerId);
            if (pointers.size < 2) pinchStart = 0;
            // 指针捕获会把 click 事件重定向到 scene 自身，surface 上的 click 委托会失效，
            // 因此在 pointerup 时用 elementFromPoint 做命中补判（轻点落子，拖拽不落子）
            if (wasSingle && !dragMoved) {
                if (scene.hasPointerCapture(e.pointerId)) scene.releasePointerCapture(e.pointerId);
                var t = document.elementFromPoint(e.clientX, e.clientY);
                var hit = t && t.closest && t.closest('.hitarea');
                if (hit && onCellClick) onCellClick(Number(hit.dataset.row), Number(hit.dataset.col));
            }
        }
        scene.addEventListener('pointerup', endPointer);
        scene.addEventListener('pointercancel', endPointer);

        scene.addEventListener('wheel', function (e) {
            e.preventDefault();
            tScale = clamp(tScale * (e.deltaY < 0 ? 1.08 : 0.92), SCALE_MIN, SCALE_MAX);
            kick();
        }, { passive: false });

        // 拖拽后不触发落子
        scene.addEventListener('dblclick', resetView);
        scene.addEventListener('mouseleave', function () {
            if (onCellLeave) onCellLeave();
        });

        // 悬停虚影（命中区事件委托）
        surface.addEventListener('mouseover', function (e) {
            var t = e.target.closest('.hitarea');
            if (t && onCellHover) onCellHover(Number(t.dataset.row), Number(t.dataset.col));
        });
        surface.addEventListener('mouseout', function (e) {
            if (e.target.closest('.hitarea') && onCellLeave) onCellLeave();
        });
    }

    function resetView() {
        tRx = DEF_RX; tRz = 0; tScale = 1;
        kick();
    }

    var rafId = 0;

    function applyTransform() {
        stage.style.transform = 'rotateX(' + cRx.toFixed(2) + 'deg) rotateZ(' + cRz.toFixed(2) +
            'deg) scale(' + cScale.toFixed(3) + ')';
    }

    function loop() {
        var drx = tRx - cRx, drz = tRz - cRz, dsc = tScale - cScale;
        if (Math.abs(drx) > 0.01 || Math.abs(drz) > 0.01 || Math.abs(dsc) > 0.0005) {
            cRx += drx * 0.18;
            cRz += drz * 0.18;
            cScale += dsc * 0.18;
            applyTransform();
            rafId = requestAnimationFrame(loop);
        } else {
            // 收敛后吸附到目标值并停笔：无交互时保持合成器空闲，
            // 落子新增棋子元素时才不会因持续写 transform 抢帧而抖动一下
            cRx = tRx; cRz = tRz; cScale = tScale;
            applyTransform();
            rafId = 0;
        }
    }

    // 交互后唤醒视角过渡循环
    function kick() { if (!rafId) rafId = requestAnimationFrame(loop); }

    /* ================= 对外接口 ================= */

    function init(root, opts) {
        scene = root;
        onCellClick = opts.onCellClick;
        onCellHover = opts.onCellHover;
        onCellLeave = opts.onCellLeave;
        buildScene();
        bindEvents();
        resetView();
        kick();
    }

    window.Board3D = {
        init: init,
        render: render,
        resetView: resetView
    };
})();
