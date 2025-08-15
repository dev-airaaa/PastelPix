(() => {
    // ====== Helpers ======
    const $ = (sel, el = document) => el.querySelector(sel);
    const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
    const clamp = (v, min, max) => v < min ? min : v > max ? max : v;

    // ====== State ======
    const state = {
        w: 32,
        h: 32,
        brush: 1,
        color: '#ff66a3',
        tool: 'brush',
        isDown: false,
        start: null,
        panMode: false,
        zoom: 1,
        pan: {
            x: 0,
            y: 0
        },
        history: [],
        historyIdx: -1,
        saving: false,
    };

    // ====== DOM ======
    const app = $('#app');
    const splash = $('#splash');

    const pixel = $('#pixel');
    const px = pixel.getContext('2d', {
        willReadFrequently: true
    });

    const overlay = $('#overlay');
    const ox = overlay.getContext('2d');

    const grid = $('#grid');
    const gx = grid.getContext('2d');

    const wrap = $('#wrap');
    const stage = $('#stage');
    const shell = $('.canvas-shell');

    const colorInp = $('#color');
    const swatch = $('#swatch');
    const brushInp = $('#brush');
    const brushLabel = $('#brushLabel');
    const btnNew = $('#btn-new');
    const btnExport = $('#btn-export');
    const btnClear = $('#btn-clear');
    const inpW = $('#inp-w');
    const inpH = $('#inp-h');
    const btnResize = $('#btn-resize');
    const gridToggle = $('#gridToggle');
    const gridAlpha = $('#gridAlpha');
    const exportScale = $('#exportScale');
    const status = $('#status');
    const zoomBadge = $('#zoomBadge');
    const posBadge = $('#posBadge');
    const toast = $('#toast');

    // ====== Config (display) ======
    const CELL = 20; // display-size per pixel unit (base before zoom)
    function canvasSizePx() {
        return {
            w: state.w * CELL,
            h: state.h * CELL
        };
    }

    // ====== Init ======
    function setCanvasSize(w, h) {
        state.w = w;
        state.h = h;
        const {
            w: W,
            h: H
        } = canvasSizePx();
        [pixel, overlay, grid].forEach(c => {
            c.width = W;
            c.height = H;
        });
        px.imageSmoothingEnabled = false;
        ox.imageSmoothingEnabled = false;
        gx.imageSmoothingEnabled = false;
        drawChecker();
        render();
        // recenter after size changes
        centerWrap();
    }

    function centerWrap() {
        // center in shell while keeping current zoom (but adjust pan for center)
        const sh = shell.getBoundingClientRect();
        const w = pixel.width * state.zoom;
        const h = pixel.height * state.zoom;
        state.pan.x = Math.floor((sh.width - w) / 2);
        state.pan.y = Math.floor((sh.height - h) / 2);
        applyTransform();
        updateZoomBadge();
    }

    function applyTransform() {
        wrap.style.transform = `translate(${state.pan.x}px, ${state.pan.y}px) scale(${state.zoom})`;
    }

    function updateZoomBadge() {
        zoomBadge.textContent = `${Math.round(state.zoom*100)}%`;
    }

    function setTool(id) {
        state.tool = id;
        $$('.tool').forEach(b => b.classList.toggle('active', b.dataset.tool === id));
        setStatus(`Tool: ${id}`);
    }

    function setStatus(msg) {
        status.textContent = msg;
    }

    // ====== Grid ======
    function drawChecker() {
        gx.clearRect(0, 0, grid.width, grid.height);
        if (!gridToggle.checked) return;
        gx.globalAlpha = parseFloat(gridAlpha.value || "0.25");
        gx.strokeStyle = 'rgba(0,0,0,.4)';
        gx.lineWidth = 1;
        gx.beginPath();
        for (let x = 0; x <= state.w; x++) {
            const X = x * CELL + .5;
            gx.moveTo(X, 0);
            gx.lineTo(X, grid.height);
        }
        for (let y = 0; y <= state.h; y++) {
            const Y = y * CELL + .5;
            gx.moveTo(0, Y);
            gx.lineTo(grid.width, Y);
        }
        gx.stroke();
        gx.globalAlpha = 1;
    }

    // ====== History / Undo ======
    function pushHistory() {
        const MAX = 200;
        const snap = px.getImageData(0, 0, pixel.width, pixel.height);
        state.history.splice(state.historyIdx + 1);
        state.history.push(snap);
        if (state.history.length > MAX) state.history.shift();
        state.historyIdx = state.history.length - 1;
        scheduleSave();
    }

    function restoreImageData(imgData) {
        px.putImageData(imgData, 0, 0);
        render();
    }

    function undo() {
        if (state.historyIdx > 0) {
            state.historyIdx--;
            restoreImageData(state.history[state.historyIdx]);
            setStatus('Undo');
            scheduleSave();
        }
    }

    function redo() {
        if (state.historyIdx < state.history.length - 1) {
            state.historyIdx++;
            restoreImageData(state.history[state.historyIdx]);
            setStatus('Redo');
            scheduleSave();
        }
    }

    // ====== Local Storage ======
    const LS_KEY = 'pastel_pixel_editor_stable_v1';
    let saveRaf = 0;

    function scheduleSave() {
        if (saveRaf) cancelAnimationFrame(saveRaf);
        saveRaf = requestAnimationFrame(() => {
            try {
                const dataURL = pixel.toDataURL('image/png');
                const save = {
                    w: state.w,
                    h: state.h,
                    img: dataURL,
                    zoom: state.zoom,
                    pan: state.pan,
                    color: state.color,
                    brush: state.brush
                };
                localStorage.setItem(LS_KEY, JSON.stringify(save));
                showToast();
            } catch (e) {
                /* ignore quota */ }
        });
    }

    function tryRestore() {
        const raw = localStorage.getItem(LS_KEY);
        if (!raw) return false;
        try {
            const save = JSON.parse(raw);
            // set size first so canvases ready
            setCanvasSize(save.w || 32, save.h || 32);
            const img = new Image();
            img.onload = () => {
                px.clearRect(0, 0, pixel.width, pixel.height);
                px.drawImage(img, 0, 0, pixel.width, pixel.height);
                pushHistory(); // seed
                state.zoom = save.zoom || 1;
                state.pan = save.pan || {
                    x: 0,
                    y: 0
                };
                state.color = save.color || '#ff66a3';
                state.brush = save.brush || 1;
                colorInp.value = state.color;
                swatch.textContent = state.color;
                brushInp.value = state.brush;
                brushLabel.textContent = `${state.brush} px`;
                applyTransform();
                render();
            };
            img.src = save.img;
            return true;
        } catch (e) {
            return false;
        }
    }

    // ====== Rendering ======
    function render() {
        /* grid drawn separately; overlay used for previews */ }

    // ====== Drawing Helpers (grid coords) ======
    function getCellFromEvent(e) {
        const r = overlay.getBoundingClientRect();
        const cellW = r.width / state.w;
        const cellH = r.height / state.h;
        const x = Math.floor((e.clientX - r.left) / cellW);
        const y = Math.floor((e.clientY - r.top) / cellH);
        return {
            x: clamp(x, 0, state.w - 1),
            y: clamp(y, 0, state.h - 1)
        };
    }

    function paintCellRect(x, y, size, erase = false) {
        const s = Math.max(1, size) | 0;
        const startX = clamp(x - Math.floor((s - 1) / 2), 0, state.w - 1);
        const startY = clamp(y - Math.floor((s - 1) / 2), 0, state.h - 1);
        const W = Math.min(s, state.w - startX);
        const H = Math.min(s, state.h - startY);
        if (erase) {
            px.clearRect(startX * CELL, startY * CELL, W * CELL, H * CELL);
        } else {
            px.fillStyle = state.color;
            px.fillRect(startX * CELL, startY * CELL, W * CELL, H * CELL);
        }
    }

    function rasterLine(p1, p2, cb) {
        let x0 = p1.x,
            y0 = p1.y,
            x1 = p2.x,
            y1 = p2.y;
        const dx = Math.abs(x1 - x0),
            sx = x0 < x1 ? 1 : -1;
        const dy = -Math.abs(y1 - y0),
            sy = y0 < y1 ? 1 : -1;
        let err = dx + dy,
            e2;
        while (true) {
            cb(x0, y0);
            if (x0 === x1 && y0 === y1) break;
            e2 = 2 * err;
            if (e2 >= dy) {
                err += dy;
                x0 += sx;
            }
            if (e2 <= dx) {
                err += dx;
                y0 += sy;
            }
        }
    }

    function rasterRect(p1, p2, cb) {
        const x = Math.min(p1.x, p2.x),
            y = Math.min(p1.y, p2.y);
        const w = Math.abs(p1.x - p2.x) + 1,
            h = Math.abs(p1.y - p2.y) + 1;
        for (let iy = 0; iy < h; iy++)
            for (let ix = 0; ix < w; ix++) cb(x + ix, y + iy);
    }

    function rasterCircle(p1, p2, cb) {
        const cx = Math.round((p1.x + p2.x) / 2);
        const cy = Math.round((p1.y + p2.y) / 2);
        const rx = Math.abs(p2.x - p1.x) / 2;
        const ry = Math.abs(p2.y - p1.y) / 2;
        const minX = Math.floor(cx - rx),
            maxX = Math.ceil(cx + rx);
        const minY = Math.floor(cy - ry),
            maxY = Math.ceil(cy + ry);
        for (let y = minY; y <= maxY; y++) {
            for (let x = minX; x <= maxX; x++) {
                const nx = (x - cx) / (rx || 1e-9);
                const ny = (y - cy) / (ry || 1e-9);
                if (nx * nx + ny * ny <= 1.0) cb(x, y);
            }
        }
    }

    // ====== Tools ======
    function onPointerDown(e) {
        if (state.panMode) return; // panning handled elsewhere
        state.isDown = true;
        const p = getCellFromEvent(e);
        state.start = p;
        ox.clearRect(0, 0, overlay.width, overlay.height);

        if (state.tool === 'brush' || state.tool === 'eraser') {
            paintCellRect(p.x, p.y, state.brush, state.tool === 'eraser');
        } else if (state.tool === 'fill') {
            floodFill(p.x, p.y);
            pushHistory();
            state.isDown = false; // instant tool
        } else {
            drawPreview(p);
        }
        updatePosBadge(p);
    }

    function onPointerMove(e) {
        const p = getCellFromEvent(e);
        updatePosBadge(p);
        if (!state.isDown) return;
        if (state.tool === 'brush' || state.tool === 'eraser') {
            paintCellRect(p.x, p.y, state.brush, state.tool === 'eraser');
        } else {
            drawPreview(p);
        }
    }

    function onPointerUp(e) {
        if (!state.isDown) return;
        state.isDown = false;
        const p = getCellFromEvent(e);
        if (state.tool === 'line') {
            rasterLine(state.start, p, (x, y) => paintCellRect(x, y, state.brush, false));
        } else if (state.tool === 'rect') {
            rasterRect(state.start, p, (x, y) => paintCellRect(x, y, state.brush, false));
        } else if (state.tool === 'circle') {
            rasterCircle(state.start, p, (x, y) => paintCellRect(x, y, state.brush, false));
        }
        ox.clearRect(0, 0, overlay.width, overlay.height);
        pushHistory();
    }

    function drawPreview(p) {
        ox.clearRect(0, 0, overlay.width, overlay.height);
        ox.globalAlpha = .85;
        ox.fillStyle = state.color;
        const drawCell = (x, y) => ox.fillRect(x * CELL, y * CELL, CELL, CELL);
        if (state.tool === 'line') rasterLine(state.start, p, drawCell);
        else if (state.tool === 'rect') rasterRect(state.start, p, drawCell);
        else if (state.tool === 'circle') rasterCircle(state.start, p, drawCell);
        ox.globalAlpha = 1;
    }

    // Flood fill (cell-based via sampling)
    function floodFill(startX, startY) {
        const img = px.getImageData(0, 0, pixel.width, pixel.height);
        const data = img.data;
        const Wpx = pixel.width;

        function getCellRGBA(x, y) {
            const idx = ((y * CELL) * Wpx + (x * CELL)) * 4;
            return [data[idx], data[idx + 1], data[idx + 2], data[idx + 3]];
        }
        const target = getCellRGBA(startX, startY);
        const newCol = hexToRgbA(state.color);
        if (colorsEq(target, newCol)) return;

        const W = state.w,
            H = state.h;
        const q = [{
            x: startX,
            y: startY
        }];
        const seen = new Uint8Array(W * H);

        while (q.length) {
            const {
                x,
                y
            } = q.pop();
            const id = y * W + x;
            if (seen[id]) continue;
            seen[id] = 1;
            if (!colorsEq(getCellRGBA(x, y), target)) continue;
            px.fillStyle = state.color;
            px.fillRect(x * CELL, y * CELL, CELL, CELL);
            if (x > 0) q.push({
                x: x - 1,
                y
            });
            if (x < W - 1) q.push({
                x: x + 1,
                y
            });
            if (y > 0) q.push({
                x,
                y: y - 1
            });
            if (y < H - 1) q.push({
                x,
                y: y + 1
            });
        }
    }

    function colorsEq(a, b) {
        return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
    }

    function hexToRgbA(hex) {
        const h = hex.replace('#', '');
        const n = parseInt(h, 16);
        const r = (h.length === 3) ? ((n >> 8) & 0xF) * 17 : (n >> 16) & 0xFF;
        const g = (h.length === 3) ? ((n >> 4) & 0xF) * 17 : (n >> 8) & 0xFF;
        const b = (h.length === 3) ? (n & 0xF) * 17 : (n >> 0) & 0xFF;
        return [r, g, b, 255];
    }

    // ====== Position / UI ======
    function updatePosBadge(p) {
        posBadge.textContent = `(${p.x}, ${p.y})`;
    }

    // Stable zoom around mouse with transform-origin (0,0)
    function onWheel(e) {
        e.preventDefault();
        const factor = (e.deltaY < 0) ? 1.1 : 0.9;
        const newZoom = clamp(state.zoom * factor, 0.2, 40);

        // mouse in shell coords
        const shellRect = shell.getBoundingClientRect();
        const mx = e.clientX - shellRect.left;
        const my = e.clientY - shellRect.top;

        // world coords (relative to current transform)
        const wx = (mx - state.pan.x) / state.zoom;
        const wy = (my - state.pan.y) / state.zoom;

        // new pan so that (wx,wy) stays under cursor
        state.pan.x = mx - wx * newZoom;
        state.pan.y = my - wy * newZoom;
        state.zoom = newZoom;
        applyTransform();
        updateZoomBadge();
    }

    function onStageDown(e) {
        if (e.button !== 0) return;
        if (!state.panMode) return;
        stage.style.cursor = 'grabbing';
        state.__panStart = {
            x: e.clientX - state.pan.x,
            y: e.clientY - state.pan.y
        };
        window.addEventListener('mousemove', onStageMove);
        window.addEventListener('mouseup', onStageUp);
    }

    function onStageMove(e) {
        state.pan.x = e.clientX - state.__panStart.x;
        state.pan.y = e.clientY - state.__panStart.y;
        applyTransform();
    }

    function onStageUp() {
        stage.style.cursor = 'grab';
        window.removeEventListener('mousemove', onStageMove);
        window.removeEventListener('mouseup', onStageUp);
    }

    // ====== Export / New / Clear / Resize ======
    function exportPNG() {
        const scale = Math.max(1, Math.min(64, parseInt(exportScale.value || "8", 10)));
        const out = document.createElement('canvas');
        out.width = state.w * scale;
        out.height = state.h * scale;
        const cx = out.getContext('2d');
        cx.imageSmoothingEnabled = false;
        cx.drawImage(pixel, 0, 0, pixel.width, pixel.height, 0, 0, out.width, out.height);
        const link = document.createElement('a');
        link.download = 'pastel_pixel.png';
        link.href = out.toDataURL('image/png');
        link.click();
        setStatus(`Exported ×${scale}`);
    }

    function clearCanvas() {
        px.clearRect(0, 0, pixel.width, pixel.height);
        pushHistory();
    }

    function newCanvas() {
        if (!confirm('Start a new canvas? Autosave keeps your last snapshot, but this clears the current image.')) return;
        px.clearRect(0, 0, pixel.width, pixel.height);
        pushHistory();
    }

    function resizeCanvas() {
        const w = clamp(parseInt(inpW.value || state.w, 10), 4, 256);
        const h = clamp(parseInt(inpH.value || state.h, 10), 4, 256);
        if (w === state.w && h === state.h) return;
        const tmp = document.createElement('canvas');
        tmp.width = pixel.width;
        tmp.height = pixel.height;
        tmp.getContext('2d').drawImage(pixel, 0, 0);
        setCanvasSize(w, h);
        px.imageSmoothingEnabled = false;
        px.drawImage(tmp, 0, 0, tmp.width, tmp.height, 0, 0, pixel.width, pixel.height);
        pushHistory();
    }

    // ====== Toast ======
    let toastTimer = 0;

    function showToast() {
        clearTimeout(toastTimer);
        toast.classList.add('show');
        toastTimer = setTimeout(() => toast.classList.remove('show'), 1500);
    }

    // ====== Events ======
    overlay.addEventListener('mousedown', onPointerDown);
    overlay.addEventListener('mousemove', onPointerMove);
    window.addEventListener('mouseup', onPointerUp);

    stage.addEventListener('wheel', onWheel, {
        passive: false
    });
    stage.addEventListener('mousedown', onStageDown);

    // Select tool by click
    $$('#tools .tool').forEach(b => b.addEventListener('click', () => setTool(b.dataset.tool)));

    // Inputs
    colorInp.addEventListener('input', e => {
        state.color = e.target.value;
        swatch.textContent = state.color;
    });
    brushInp.addEventListener('input', e => {
        state.brush = parseInt(e.target.value, 10);
        brushLabel.textContent = `${state.brush} px`;
    });
    gridToggle.addEventListener('change', drawChecker);
    gridAlpha.addEventListener('input', drawChecker);

    btnExport.addEventListener('click', exportPNG);
    btnClear.addEventListener('click', clearCanvas);
    btnNew.addEventListener('click', newCanvas);
    btnResize.addEventListener('click', resizeCanvas);

    // Hotkeys
    window.addEventListener('keydown', (e) => {
        // ignore while typing in inputs
        const tag = (e.target.tagName || '').toLowerCase();
        if (tag === 'input') return;

        const k = e.key.toLowerCase();
        if (e.ctrlKey || e.metaKey) {
            if (k === 'z' && !e.shiftKey) {
                e.preventDefault();
                undo();
            } else if ((k === 'z' && e.shiftKey) || k === 'y') {
                e.preventDefault();
                redo();
            }
            return;
        }
        if (k === '+') {
            e.preventDefault();
            state.zoom = clamp(state.zoom * 1.1, 0.2, 40);
            applyTransform();
            updateZoomBadge();
        }
        if (k === '-') {
            e.preventDefault();
            state.zoom = clamp(state.zoom / 1.1, 0.2, 40);
            applyTransform();
            updateZoomBadge();
        }

        // tools
        const map = {
            b: 'brush',
            e: 'eraser',
            f: 'fill',
            l: 'line',
            r: 'rect',
            c: 'circle'
        };
        if (map[k]) {
            e.preventDefault();
            setTool(map[k]);
        }

        // pan mode
        if (e.code === 'Space' && !state.panMode) {
            e.preventDefault();
            state.panMode = true;
            stage.style.cursor = 'grab';
        }
    });
    window.addEventListener('keyup', (e) => {
        if (e.code === 'Space') {
            state.panMode = false;
            stage.style.cursor = 'default';
        }
    });

    // Handle window resize → keep canvas centered
    window.addEventListener('resize', centerWrap);

    // ====== Boot ======
    function boot() {
        setCanvasSize(state.w, state.h);
        px.clearRect(0, 0, pixel.width, pixel.height);
        pushHistory();
        setTool('brush');

        // Try restore last session
        const restored = tryRestore();
        if (!restored) {
            centerWrap();
        }

        app.removeAttribute('aria-hidden');
        // fade out splash then remove node (prevents blocking clicks)
        setTimeout(() => {
            splash.classList.add('hidden');
            setTimeout(() => splash.remove(), 500);
        }, 250);
    }
    // start
    boot();
})();