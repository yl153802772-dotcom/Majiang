export interface Point2 { readonly x: number; readonly y: number; }
export interface Rect2 extends Point2 { readonly width: number; readonly height: number; }
function positive(value: number): void { if (!Number.isFinite(value) || value <= 0) throw new Error('Invalid viewport dimension'); }
function rectangle(rect: Rect2): void { positive(rect.width); positive(rect.height); if (!Number.isFinite(rect.x) || !Number.isFinite(rect.y)) throw new Error('Invalid viewport origin'); }
/** Design coordinates: top-left; viewport/world coordinates: bottom-left/up. All input rectangles use one unit. */
export class ViewportLayout {
    readonly content: Rect2;
    readonly available: Rect2;
    readonly scale: number;
    readonly design: Readonly<{ width: number; height: number }>;
    constructor(design: { width: number; height: number }, readonly viewport: Rect2, safe: Rect2 = viewport, reservedTop = 0) {
        positive(design.width); positive(design.height); rectangle(viewport); rectangle(safe);
        if (!Number.isFinite(reservedTop) || reservedTop < 0) throw new Error('Invalid reserved top');
        const x = Math.max(viewport.x, safe.x), y = Math.max(viewport.y, safe.y);
        const right = Math.min(viewport.x + viewport.width, safe.x + safe.width);
        const top = Math.min(viewport.y + viewport.height, safe.y + safe.height) - reservedTop;
        this.available = Object.freeze({ x, y, width: right - x, height: top - y }); rectangle(this.available);
        this.design = Object.freeze({ ...design });
        this.viewport = Object.freeze({ ...viewport });
        this.scale = Math.min(this.available.width / design.width, this.available.height / design.height);
        const width = design.width * this.scale, height = design.height * this.scale;
        this.content = Object.freeze({ x: x + (this.available.width - width) / 2, y: y + (this.available.height - height) / 2, width, height });
    }
    toViewport(point: Point2): Point2 { return { x: this.content.x + point.x * this.scale, y: this.content.y + (this.design.height - point.y) * this.scale }; }
    fromViewport(point: Point2): Point2 { return { x: (point.x - this.content.x) / this.scale, y: this.design.height - (point.y - this.content.y) / this.scale }; }
    contains(point: Point2): boolean { const p = this.fromViewport(point); return p.x >= 0 && p.y >= 0 && p.x <= this.design.width && p.y <= this.design.height; }
    toWorld(point: Point2, unitsPerPixel = 0.01): Point2 { positive(unitsPerPixel); return { x: (point.x - this.design.width / 2) * unitsPerPixel, y: (this.design.height / 2 - point.y) * unitsPerPixel }; }
    /** Full-frame orthographic camera: viewport and content must both be in physical pixels (or both CSS pixels). */
    camera(unitsPerPixel = 0.01): { x: number; y: number; halfHeight: number } {
        positive(unitsPerPixel); const ratio = unitsPerPixel / this.scale;
        return { x: (this.viewport.x + this.viewport.width / 2 - this.content.x - this.content.width / 2) * ratio,
            y: (this.viewport.y + this.viewport.height / 2 - this.content.y - this.content.height / 2) * ratio,
            halfHeight: this.viewport.height * ratio / 2 };
    }
}
