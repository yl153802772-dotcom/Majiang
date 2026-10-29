export class IdGenerator {
    private static current = 0;
    static next(): number {
        if (this.current >= Number.MAX_SAFE_INTEGER) throw new Error('ID space exhausted');
        return ++this.current;
    }
}
