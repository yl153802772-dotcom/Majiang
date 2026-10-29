import test from 'node:test';
import assert from 'node:assert/strict';
import { ViewportLayout } from '../../assets/Framework/Kernel/ViewportLayout.ts';
import { TableProjector } from '../../assets/Game/Presentation/TableProjector.ts';

const DESIGN = { width: 720, height: 1280 };
const FULL_UI = { x: 0, y: 0, width: 720, height: 1280 };
const FULL_PIXELS_1 = { x: 0, y: 0, width: 720, height: 1280 };
const FULL_PIXELS_2 = { x: 0, y: 0, width: 1440, height: 2560 };

function snapshot(ui, pixels) {
    return { ui, pixels, physicalWidth: pixels.width, physicalHeight: pixels.height, devicePixelRatio: pixels.width / ui.width };
}

test('GAME-UI-01 viewport: full 720x1280 at DPR 1/2/3 has the same 6.4 world half-height', () => {
    for (const dpr of [1, 2, 3]) {
        const ui = new ViewportLayout(DESIGN, FULL_UI);
        const pixels = new ViewportLayout(DESIGN, { x: 0, y: 0, width: 720 * dpr, height: 1280 * dpr });
        const camera = pixels.camera(0.01);
        assert.ok(Math.abs(camera.halfHeight - 6.4) < 1e-9, 'DPR ' + dpr);
        assert.ok(Math.abs(camera.x) < 1e-9);
        assert.ok(Math.abs(camera.y) < 1e-9);
    }
});

test('GAME-UI-01 viewport: top/bottom safe area produces the hand-calculated 116.25/958.75 point', () => {
    const layout = new ViewportLayout(DESIGN, FULL_UI, { x: 0, y: 40, width: 720, height: 1200 });
    const point = layout.toViewport({ x: 100, y: 300 });
    assert.ok(Math.abs(point.x - 116.25) < 1e-9, 'x ' + point.x);
    assert.ok(Math.abs(point.y - 958.75) < 1e-9, 'y ' + point.y);
    const back = layout.fromViewport(point);
    assert.ok(Math.abs(back.x - 100) < 1e-9);
    assert.ok(Math.abs(back.y - 300) < 1e-9);
});

test('GAME-UI-01 viewport: logical board <-> art frame is reversible and does not double-fit world', () => {
    const ui = new ViewportLayout(DESIGN, FULL_UI);
    const projector = new TableProjector();
    projector.setViewport(snapshot(ui, new ViewportLayout(DESIGN, FULL_PIXELS_2)));
    for (const point of [{ x: 64, y: 160 }, { x: 188, y: 160 }, { x: 650, y: 720 }, { x: 360, y: 640 }]) {
        const art = projector.logicalToArt(point.x, point.y);
        const back = projector.artToLogical(art.x, art.y);
        assert.ok(Math.abs(back.x - point.x) <= 1, `x ${point.x}`);
        assert.ok(Math.abs(back.y - point.y) <= 1, `y ${point.y}`);
        assert.deepEqual(projector.uiToDesign(projector.designToUi(point.x, point.y).x, projector.designToUi(point.x, point.y).y), point);
    }
    assert.ok(Math.abs(projector.designToWorldScale(64) - 0.64) < 1e-9);
    assert.ok(Math.abs(projector.logicalToWorldScale(64) - 0.64 * 0.7794117647058824) < 1e-9);
});

test('GAME-UI-01 viewport: camera projection independently maps world center to physical center', () => {
    const pixels = new ViewportLayout(DESIGN, FULL_PIXELS_2);
    const camera = pixels.camera(0.01);
    const worldCenter = pixels.toWorld({ x: 360, y: 640 }, 0.01);
    assert.ok(Math.abs(worldCenter.x) < 1e-9);
    assert.ok(Math.abs(worldCenter.y) < 1e-9);
    assert.ok(Math.abs(camera.halfHeight - 6.4) < 1e-9);
});
