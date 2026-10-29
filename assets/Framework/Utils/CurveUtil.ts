// CurveUtil.ts
export class CurveUtil {

    /** 幂函数曲线（控制节奏） */
    static pow(t: number, pow: number): number {
        return Math.pow(t, pow);
    }

    /** easeOut */
    static easeOut(t: number): number {
        return 1 - Math.pow(1 - t, 2);
    }

    /** easeInOut */
    static easeInOut(t: number): number {
        return t < 0.5
            ? 2 * t * t
            : 1 - Math.pow(-2 * t + 2, 2) / 2;
    }
    
}