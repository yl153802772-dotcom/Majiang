export type LogLevelName = 'debug' | 'info' | 'warn' | 'error' | 'silent';
export enum LogLevel { DEBUG, INFO, WARN, ERROR, SILENT }
export interface LogSink { write(level: Exclude<LogLevelName, 'silent'>, module: string, values: readonly unknown[]): void; }
const levels: Exclude<LogLevelName, 'silent'>[] = ['debug', 'info', 'warn', 'error'];
/** No engine/platform dependency; inject a WeChat sink explicitly if required. */
export class Logger {
    private static level = LogLevel.INFO;
    private static sink: LogSink = { write: (level, module, values) => console[level]('[' + module + ']', ...values) };
    static configure(options: { level?: LogLevel; sink?: LogSink }): void {
        if (options.level !== undefined) this.level = options.level;
        if (options.sink) this.sink = options.sink;
    }
    static setLogLevel(level: LogLevel): void { this.level = level; }
    static getLogLevel(): LogLevel { return this.level; }
    static get isDebug(): boolean { return this.level === LogLevel.DEBUG; }
    static set isDebug(enabled: boolean) { this.level = enabled ? LogLevel.DEBUG : LogLevel.INFO; }
    private static write(level: LogLevel, module: string, values: readonly unknown[]): void {
        if (level >= this.level && level < LogLevel.SILENT) this.sink.write(levels[level], module, values);
    }
    static debug(module: string, ...values: unknown[]): void { this.write(LogLevel.DEBUG, module, values); }
    static info(module: string, ...values: unknown[]): void { this.write(LogLevel.INFO, module, values); }
    static warn(module: string, ...values: unknown[]): void { this.write(LogLevel.WARN, module, values); }
    static error(module: string, ...values: unknown[]): void { this.write(LogLevel.ERROR, module, values); }
}
export const LogModule = {
    APP: 'App', FRAMEWORK: 'Framework', DATA: 'Data', AUDIO: 'Audio', POOL: 'Pool',
    UI_MANAGER: 'UI', UIBase: 'UIBase', RES_MANAGER: 'Resources', ModuleSystem: 'Modules',
    ConfigManager: 'Config', GMManager: 'Diagnostics'
} as const;
