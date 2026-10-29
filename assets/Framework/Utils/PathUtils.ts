import { Vec3 } from 'cc';
export interface IPathData { readonly points: readonly Vec3[]; readonly segmentLengths: readonly number[]; readonly totalLength: number; }
/** Generic 3D polyline utilities. Game-specific point placement rules are outside the framework. */
export class PathUtils {
    static computePathData(points: readonly Vec3[]): IPathData {
        if (!points.length) throw new Error('Path is empty');
        const copy = points.map(p => p.clone()), lengths = copy.slice(1).map((p, i) => Vec3.distance(copy[i], p));
        return { points: copy, segmentLengths: lengths, totalLength: lengths.reduce((a, b) => a + b, 0) };
    }
    static getPosAndAngle(distance: number, path: IPathData): { pos: Vec3; angle: number } {
        if (!Number.isFinite(distance) || !path.points.length) throw new Error('Invalid path sample');
        let remaining = Math.max(0, Math.min(distance, path.totalLength));
        for (let i = 0; i < path.segmentLengths.length; i++) {
            const length = path.segmentLengths[i];
            if (!length) continue;
            if (remaining <= length) {
                const a = path.points[i], b = path.points[i + 1];
                return { pos: Vec3.lerp(new Vec3(), a, b, remaining / length), angle: Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI };
            }
            remaining -= length;
        }
        return { pos: path.points[path.points.length - 1].clone(), angle: 0 };
    }
    static getDistanceByPos(point: Vec3, path: IPathData): number {
        let best = Infinity, distance = 0, offset = 0;
        const delta = new Vec3(), relative = new Vec3(), projected = new Vec3();
        for (let i = 0; i < path.segmentLengths.length; i++) {
            const a = path.points[i], b = path.points[i + 1], length = path.segmentLengths[i];
            if (!length) continue;
            Vec3.subtract(delta, b, a); Vec3.subtract(relative, point, a);
            const t = Math.max(0, Math.min(1, Vec3.dot(relative, delta) / (length * length)));
            Vec3.lerp(projected, a, b, t);
            const squared = Vec3.squaredDistance(point, projected);
            if (squared < best) { best = squared; distance = offset + t * length; }
            offset += length;
        }
        return distance;
    }
}
