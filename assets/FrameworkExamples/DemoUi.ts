import { Button, Color, Graphics, Label, Layers, Node, UITransform } from 'cc';
export function box(parent: Node, name: string, width: number, height: number): Node {
    const node = new Node(name); node.layer = Layers.Enum.UI_2D; parent.addChild(node);
    node.addComponent(UITransform).setContentSize(width, height); return node;
}
export function label(parent: Node, text: string, width = 640, height = 80, fontSize = 25): Label {
    const node = box(parent, 'Text', width, height), value = node.addComponent(Label);
    value.string = text; value.fontSize = fontSize; value.lineHeight = fontSize + 8;
    value.horizontalAlign = Label.HorizontalAlign.CENTER; value.verticalAlign = Label.VerticalAlign.CENTER;
    value.color = new Color(235, 240, 250); return value;
}
export function place(node: Node, x: number, y: number): void { node.setPosition(x - 360, 640 - y, 0); }
export function button(parent: Node, text: string, x: number, y: number, action: () => void, width = 280): Node {
    const node = box(parent, text, width, 80), graphics = node.addComponent(Graphics);
    graphics.fillColor = new Color(39, 76, 105, 255); graphics.roundRect(-width / 2, -40, width, 80, 12); graphics.fill();
    label(node, text, width - 12, 70, 24); node.addComponent(Button); node.on(Button.EventType.CLICK, action); place(node, x, y); return node;
}
