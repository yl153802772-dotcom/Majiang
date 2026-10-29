// DelayUtil.ts
import { CurveUtil } from './CurveUtil';

export class DelayUtil {

    /**
     * 非线性错峰
     */
    static getDelay(
        index: number,
        total: number,
        pow: number,
        maxDelay: number
    ): number {

        if (total <= 1) return 0;

        const t = index / (total - 1);
        const curved = CurveUtil.pow(t, pow);

        return curved * maxDelay;
    }
}