/**
 * 设计坐标 / 内容 UI 坐标 / 世界坐标 / UI 屏幕坐标的唯一转换入口。
 * 不依赖引擎运行：视口与安全区由装配层注入；相机仅作类型关联。
 */

import type { Camera } from 'cc';
import type { ViewportSnapshot } from '../../Framework/Core/ViewportService';
import {
    BLOCK_VISUALS,
    CAMERA,
    DESIGN_SIZE,
} from '../Config/PresentationConfig';

export interface ViewportMetrics {
    readonly visibleWidth: number;
    readonly visibleHeight: number;
    readonly safeX: number;
    readonly safeY: number;
    readonly safeWidth: number;
    readonly safeHeight: number;
}

export interface ContentPoint {
    readonly x: number;
    readonly y: number;
}

export interface WorldPoint {
    readonly x: number;
    readonly y: number;
    readonly z: number;
}

export interface DesignRect {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}

const DESIGN_WIDTH = DESIGN_SIZE.width;
const DESIGN_HEIGHT = DESIGN_SIZE.height;

function clamp(value: number, minimum: number, maximum: number): number {
    return Math.max(minimum, Math.min(maximum, value));
}

function finiteOr(value: number, fallback: number): number {
    return Number.isFinite(value) ? value : fallback;
}

const SOURCE_BOARD = { x: 0, y: 120, width: 720, height: 680 } as const;
const ART_BOARD = { x: 24, y: 330, width: 672, height: 530 } as const;

export class TableProjector {
    private artBoard: DesignRect = ART_BOARD;
    setArtBoard(rect: DesignRect): void {
        if (![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) || rect.width <= 0 || rect.height <= 0)
            throw new Error('Invalid art board rectangle');
        this.artBoard = { ...rect };
    }
    private camera: Camera | null = null;
    private viewport: ViewportSnapshot | null = null;
    private visibleWidth: number = DESIGN_WIDTH;
    private visibleHeight: number = DESIGN_HEIGHT;
    private contentScale = 1;
    private contentOffsetX = 0;
    private contentOffsetY = 0;

    /** Shared framework viewport; when present all UI/world/input conversions use it. */
    setViewport(viewport: ViewportSnapshot | null): void {
        this.viewport = viewport;
    }

    get viewportSnapshot(): ViewportSnapshot | null {
        return this.viewport;
    }

    /** Logical Level888 board coordinate -> art board design coordinate. */
    logicalToArt(x: number, y: number): ContentPoint {
        const scale = this.logicalScale();
        const width = SOURCE_BOARD.width * scale;
        const height = SOURCE_BOARD.height * scale;
        return {
            x: this.artBoard.x + (this.artBoard.width - width) / 2 + (x - SOURCE_BOARD.x) * scale,
            y: this.artBoard.y + (this.artBoard.height - height) / 2 + (y - SOURCE_BOARD.y) * scale,
        };
    }

    artToLogical(x: number, y: number): ContentPoint {
        const scale = this.logicalScale();
        const width = SOURCE_BOARD.width * scale;
        const height = SOURCE_BOARD.height * scale;
        return {
            x: SOURCE_BOARD.x + (x - this.artBoard.x - (this.artBoard.width - width) / 2) / scale,
            y: SOURCE_BOARD.y + (y - this.artBoard.y - (this.artBoard.height - height) / 2) / scale,
        };
    }

    logicalToWorldScale(designPixels: number): number {
        return designPixels * this.logicalScale() / this.designPixelsPerWorldUnit;
    }

    private logicalScale(): number {
        return Math.min(this.artBoard.width / SOURCE_BOARD.width, this.artBoard.height / SOURCE_BOARD.height);
    }

    // 中文注释：内容 root 的 scale/offset 只由 ViewportLayout 提供一次；坐标换算在
    // 这里完成设计坐标 -> 内容/viewport，镜头再消费同一份 fit 参数，绝不再叠加内容 scale。

    setCamera(camera: Camera | null): void {
        this.camera = camera;
    }

    getCamera(): Camera | null {
        return this.camera;
    }

    configure(metrics: ViewportMetrics): void {
        const visibleWidth = Math.max(1, finiteOr(metrics.visibleWidth, DESIGN_WIDTH));
        const visibleHeight = Math.max(1, finiteOr(metrics.visibleHeight, DESIGN_HEIGHT));
        let safeX = clamp(finiteOr(metrics.safeX, 0), 0, visibleWidth);
        let safeY = clamp(finiteOr(metrics.safeY, 0), 0, visibleHeight);
        let safeWidth = finiteOr(metrics.safeWidth, visibleWidth);
        let safeHeight = finiteOr(metrics.safeHeight, visibleHeight);
        if (!(safeWidth > 0) || !(safeHeight > 0)) {
            safeX = 0;
            safeY = 0;
            safeWidth = visibleWidth;
            safeHeight = visibleHeight;
        }
        safeWidth = Math.min(safeWidth, visibleWidth - safeX);
        safeHeight = Math.min(safeHeight, visibleHeight - safeY);
        if (!(safeWidth > 0) || !(safeHeight > 0)) {
            safeX = 0;
            safeY = 0;
            safeWidth = visibleWidth;
            safeHeight = visibleHeight;
        }

        const scale = Math.min(safeWidth / DESIGN_WIDTH, safeHeight / DESIGN_HEIGHT);
        const scaleValue = scale > 0 && Number.isFinite(scale) ? scale : 1;
        const contentWidth = DESIGN_WIDTH * scaleValue;
        const contentHeight = DESIGN_HEIGHT * scaleValue;

        this.visibleWidth = visibleWidth;
        this.visibleHeight = visibleHeight;
        this.contentScale = scaleValue;
        this.contentOffsetX = safeX + safeWidth / 2 - visibleWidth / 2;
        this.contentOffsetY = safeY + safeHeight / 2 - visibleHeight / 2;
    }

    get visibleSize(): ContentPoint {
        return { x: this.visibleWidth, y: this.visibleHeight };
    }

    get scale(): number {
        return this.contentScale;
    }

    get contentOffset(): ContentPoint {
        return { x: this.contentOffsetX, y: this.contentOffsetY };
    }

    get cameraOrthoHalfHeight(): number {
        return CAMERA.orthoHalfHeightWorld;
    }

    get designPixelsPerWorldUnit(): number {
        return CAMERA.designPixelsPerWorldUnit;
    }

    /** 未缩放的内容根局部坐标；内容根自身承担安全区 scale/offset。 */
    designToLocal(x: number, y: number): ContentPoint {
        return { x: x - DESIGN_WIDTH / 2, y: DESIGN_HEIGHT / 2 - y };
    }

    designToContent(x: number, y: number): ContentPoint {
        return {
            x: this.contentOffsetX + this.contentScale * (x - DESIGN_WIDTH / 2),
            y: this.contentOffsetY + this.contentScale * (DESIGN_HEIGHT / 2 - y),
        };
    }

    contentToDesign(x: number, y: number): ContentPoint {
        return {
            x: (x - this.contentOffsetX) / this.contentScale + DESIGN_WIDTH / 2,
            y: DESIGN_HEIGHT / 2 - (y - this.contentOffsetY) / this.contentScale,
        };
    }

    designToUi(x: number, y: number): ContentPoint {
        if (this.viewport) return this.viewport.ui.toViewport({ x, y });
        const content = this.designToContent(x, y);
        return { x: content.x + this.visibleWidth / 2, y: content.y + this.visibleHeight / 2 };
    }

    uiToDesign(x: number, y: number): ContentPoint {
        if (this.viewport) return this.viewport.ui.fromViewport({ x, y });
        return this.contentToDesign(x - this.visibleWidth / 2, y - this.visibleHeight / 2);
    }

    uiToLogical(x: number, y: number): ContentPoint {
        const art = this.uiToDesign(x, y);
        return this.artToLogical(art.x, art.y);
    }

    screenToDesign(x: number, y: number): ContentPoint {
        return this.uiToDesign(x, y);
    }

    designToWorld(x: number, y: number, z = 0): WorldPoint {
        const unit = this.designPixelsPerWorldUnit;
        if (this.viewport) {
            const point = this.viewport.ui.toWorld({ x, y }, 1 / unit);
            return { x: point.x, y: point.y, z };
        }
        return {
            x: (this.contentOffsetX + this.contentScale * (x - DESIGN_WIDTH / 2)) / unit,
            y: (this.contentOffsetY + this.contentScale * (DESIGN_HEIGHT / 2 - y)) / unit,
            z,
        };
    }

    worldToDesign(world: WorldPoint): ContentPoint {
        const unit = this.designPixelsPerWorldUnit;
        if (this.viewport) return { x: world.x * unit + DESIGN_WIDTH / 2, y: DESIGN_HEIGHT / 2 - world.y * unit };
        return {
            x: (world.x * unit - this.contentOffsetX) / this.contentScale + DESIGN_WIDTH / 2,
            y: DESIGN_HEIGHT / 2 - (world.y * unit - this.contentOffsetY) / this.contentScale,
        };
    }

    worldToUi(world: WorldPoint): ContentPoint {
        const design = this.worldToDesign(world);
        return this.designToUi(design.x, design.y);
    }

    designToWorldScale(designPixels: number): number {
        if (this.viewport) return designPixels / this.designPixelsPerWorldUnit;
        return designPixels * this.contentScale / this.designPixelsPerWorldUnit;
    }

    /** 返回设计坐标左上原点的命中矩形。 */
    getHitRect(x: number, y: number, cardCount: 1 | 2): DesignRect {
        const width = cardCount === 2 ? BLOCK_VISUALS.doubleWidth : BLOCK_VISUALS.singleWidth;
        return {
            x: x - width / 2,
            y: y - BLOCK_VISUALS.height / 2,
            width,
            height: BLOCK_VISUALS.height,
        };
    }

    containsDesignPoint(rect: DesignRect, x: number, y: number): boolean {
        return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
    }
}
