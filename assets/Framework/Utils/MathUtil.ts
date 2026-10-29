import { Vec3 } from 'cc';
export class MathUtil {
    /** Supply a seeded generator for deterministic simulations. */
    static randomRange(min: number, max: number, random: () => number = Math.random): number {
        if (!Number.isFinite(min) || !Number.isFinite(max) || max < min) throw new Error('Invalid random range');
        const value = random();
        if (!Number.isFinite(value) || value < 0 || value >= 1) throw new Error('Random source must return [0, 1)');
        return min + value * (max - min);
    }
    static getAngleDegrees2D(from: Vec3, to: Vec3): number {
        return Math.atan2(to.y - from.y, to.x - from.x) * 180 / Math.PI;
    }
}
