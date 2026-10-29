import { _decorator, Component, Label } from 'cc';
const { ccclass, property } = _decorator;
/** Translation provider is injected by the project; no fixed config table or language. */
@ccclass('I18nLabel')
export class I18nLabel extends Component {
    @property public key = '';
    private translate?: (key: string) => string;
    setProvider(provider: (key: string) => string): void { this.translate = provider; this.refresh(); }
    refresh(): void { const label = this.getComponent(Label); if (label && this.translate) label.string = this.translate(this.key); }
    protected onEnable(): void { this.refresh(); }
}
