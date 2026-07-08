export const UART_SERVICE_UUID = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
export const UART_RX_UUID = "6e400002-b5a3-f393-e0a9-e50e24dcca9e";
export const UART_TX_UUID = "6e400003-b5a3-f393-e0a9-e50e24dcca9e";

export class LineJsonParser {
  constructor(onMessage, onInvalid = () => {}) {
    this.buffer = "";
    this.onMessage = onMessage;
    this.onInvalid = onInvalid;
  }

  pushText(text) {
    this.buffer += text;
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() || "";
    for (const line of lines) this.parseLine(line);
  }

  flush() {
    const trailing = this.buffer.trim();
    this.buffer = "";
    if (trailing) this.parseLine(trailing);
  }

  parseLine(line) {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      this.onMessage(JSON.parse(trimmed));
    } catch (error) {
      this.onInvalid(trimmed, error);
    }
  }
}

export class SmartPadBle {
  constructor({ onEvent, onDisconnect, onHint }) {
    this.device = null;
    this.server = null;
    this.rxCharacteristic = null;
    this.txCharacteristic = null;
    this.connected = false;
    this.onEvent = onEvent;
    this.onDisconnect = onDisconnect;
    this.onHint = onHint;
    this.decoder = new TextDecoder();
    this.parser = new LineJsonParser(
      (event) => this.onEvent(event),
      (line, error) => console.warn("Invalid BLE JSON:", line, error)
    );
  }

  async connect() {
    if (!navigator.bluetooth) {
      throw new Error("Web Bluetooth is not available. Use Bluefy on iPhone or Chrome/Edge on desktop.");
    }
    this.onHint?.("Select SmartReactionPad from the Bluetooth picker.");
    this.device = await navigator.bluetooth.requestDevice({
      filters: [{ namePrefix: "SmartReactionPad" }],
      optionalServices: [UART_SERVICE_UUID],
    });
    this.device.addEventListener("gattserverdisconnected", () => {
      this.connected = false;
      this.onDisconnect?.();
    });
    this.server = await this.device.gatt.connect();
    const service = await this.server.getPrimaryService(UART_SERVICE_UUID);
    this.rxCharacteristic = await service.getCharacteristic(UART_RX_UUID);
    this.txCharacteristic = await service.getCharacteristic(UART_TX_UUID);
    await this.txCharacteristic.startNotifications();
    this.txCharacteristic.addEventListener("characteristicvaluechanged", (event) => {
      this.parser.pushText(this.decoder.decode(event.target.value));
    });
    this.connected = true;
  }

  async send(command) {
    if (!this.connected || !this.rxCharacteristic) throw new Error("No BLE device connected.");
    const payload = `${JSON.stringify(command)}\n`;
    await this.rxCharacteristic.writeValue(new TextEncoder().encode(payload));
  }

  async disconnect() {
    if (this.device?.gatt?.connected) this.device.gatt.disconnect();
    this.connected = false;
  }
}
