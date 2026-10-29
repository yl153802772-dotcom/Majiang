/**
 * 表现常量（无 cc 类型）。
 * 仅保存尺寸、颜色、动画与物理预算；不包含任何规则、牌池、关卡坐标或胜负判定。
 * 具体相机/Layer 在引擎接入批次按真实环境调整，调整这些数值不得改变玩法结果。
 */

export const DESIGN_SIZE = {
    width: 720,
    height: 1280,
} as const;

/** MVP_FINAL §7.2 的 Block 显示框尺寸；厚度只是首版视觉预算。 */
export const BLOCK_VISUALS = {
    singleWidth: 64,
    doubleWidth: 132,
    height: 88,
    thickness: 12,
} as const;

export const COLORS = {
    background: '#0F1419',
    table: '#1B2430',
    blockFace: '#F5F5F5',
    blockEdge: '#BFC7D5',
    blockText: '#1A1A1A',
    selectableOutline: '#39D98A',
    tenpaiMatchOutline: '#FFC857',
    winningPairOutline: '#FF7A45',
    lockedOverlay: '#66707D',
    ultimate: '#FF5C8A',
    resultWin: '#39D98A',
    resultLost: '#FF6B6B',
    panel: '#141B24',
    panelEdge: '#3A4757',
    slot: '#0C1118',
    slotEdge: '#3A4757',
    text: '#EAF0F7',
    textDim: '#9DA9B8',
    wanText: '#E05A4F',
    tongText: '#3E86C8',
    tiaoText: '#45A86B',
    warn: '#FFB454',
} as const;

export const TIMING = {
    moveMs: 180,
    fadeMs: 220,
    ultimateBurstMs: 420,
    resultPanelDelayMs: 1500,
} as const;

/** 轻 3D 视觉替身的硬预算；超限时按架构约定降级，不影响规则。 */
export const PHYSICS_BUDGET = {
    maxDynamicBodies: 12,
    maxUltimateGroups: 5,
    /** 单次刚体替身的最长寿命；毫秒，不是物理步数。 */
    physicsProxyTimeoutMs: 900,
    /** 包含非刚体表现的单次效果总时限；到期必须收尾。 */
    effectTimeoutMs: 1500,
} as const;

const DESIGN_PIXELS_PER_WORLD_UNIT = 100;

/**
 * R0 负责人批准的 UI 分区（设计像素，左上原点）。
 * 本单明确为 840～960 计番区、980～1130 七槽；以本单为准。
 */
export const UI_LAYOUT = {
    header: { top: 0, bottom: 120 },
    board: { top: 120, bottom: 800 },
    meld: { top: 840, bottom: 960 },
    buffer: { top: 980, bottom: 1130 },
    footer: { top: 1160, bottom: 1280 },
    margin: 20,
    meldSlots: 4,
    bufferSlots: 7,
    restart: { x: 612, y: 58, width: 88, height: 44 },
} as const;

/** 3D 白膜牌参数，单位为设计像素；运行时按内容缩放换算世界单位。 */
export const BLOCK_3D = {
    thickness: 12,
    layerSpacing: 35,
    tiltDegrees: 8,
} as const;

export const CAMERA = {
    /** 设计像素 / 世界单位；64×88 设计框对应 0.64×0.88 世界尺寸。 */
    designPixelsPerWorldUnit: DESIGN_PIXELS_PER_WORLD_UNIT,
    /**
     * 基准画布下的世界半高，对应 Cocos 3.8.8 Camera.orthoHeight。
     * 1280 / 100 / 2 = 6.4；不是像素高度或世界全高。
     * 引擎接入时 TableProjector 根据实际内容视口/安全区重新计算并验证往返投影。
     */
    orthoHalfHeightWorld: DESIGN_SIZE.height / DESIGN_PIXELS_PER_WORLD_UNIT / 2,
} as const;

export const PRESENTATION_CONFIG = {
    designSize: DESIGN_SIZE,
    block: BLOCK_VISUALS,
    colors: COLORS,
    timing: TIMING,
    physics: PHYSICS_BUDGET,
    camera: CAMERA,
} as const;

export type PresentationConfig = typeof PRESENTATION_CONFIG;
