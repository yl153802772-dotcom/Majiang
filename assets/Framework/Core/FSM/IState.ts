export interface IState<Context = unknown, Data = unknown> {
    onEnter(context: Context, data?: Data): void;
    onUpdate?(dt: number, context: Context): void;
    onExit?(context: Context): void;
}
