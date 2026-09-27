/**
 * WebSocket connection to one game server (protocol: ./protocol.ts). Pure transport: it reports what arrives and
 * sends what it is given; the net system (./system.ts) ties it to the dragons.
 */
import {
  BATCH_ENTRY_HEADER_BYTES,
  BATCH_HEADER_BYTES,
  MSG_SNAPSHOTS,
  PROTOCOL_VERSION,
  SNAPSHOT_BYTES,
  type ClientHello,
  type ServerErrorCode,
  type ServerText,
} from './protocol';

export interface NetClientHandlers {
  welcome(id: number, players: { id: number; name: string }[]): void;
  join(id: number, name: string): void;
  leave(id: number): void;
  /** One player's snapshot inside a received batch (SNAPSHOT_BYTES at `offset`). */
  snapshot(id: number, data: ArrayBuffer, offset: number): void;
  /** The socket closed; `error` when the server refused us, `opened` false when the upgrade itself failed. */
  closed(error: ServerErrorCode | undefined, opened: boolean): void;
}

export class NetClient {
  private readonly ws: WebSocket;
  private error?: ServerErrorCode;
  private open = false;

  constructor(url: string, private readonly on: NetClientHandlers) {
    this.ws = new WebSocket(url);
    this.ws.binaryType = 'arraybuffer';
    this.ws.onopen = () => {
      this.open = true;
      const hello: ClientHello = { type: 'hello', v: PROTOCOL_VERSION };
      this.ws.send(JSON.stringify(hello));
    };
    this.ws.onmessage = (e) => this.receive(e.data as string | ArrayBuffer);
    let opened = false;
    this.ws.addEventListener('open', () => (opened = true));
    this.ws.onclose = () => {
      this.open = false;
      this.on.closed(this.error, opened);
    };
  }

  /** Sends one snapshot; dropped while the socket is not open or backed up. */
  send(snapshot: ArrayBuffer): void {
    if (this.open && this.ws.bufferedAmount < SNAPSHOT_BYTES * 20) {
      this.ws.send(snapshot);
    }
  }

  close(): void {
    this.ws.close(1000, 'bye');
  }

  private receive(data: string | ArrayBuffer): void {
    if (typeof data === 'string') {
      let msg: ServerText;
      try {
        msg = JSON.parse(data) as ServerText;
      } catch {
        return;
      }
      switch (msg.type) {
        case 'welcome':
          this.on.welcome(msg.id, msg.players);
          break;
        case 'join':
          this.on.join(msg.id, msg.name);
          break;
        case 'leave':
          this.on.leave(msg.id);
          break;
        case 'error':
          this.error = msg.code;
          break;
      }
      return;
    }
    const view = new DataView(data);
    if (data.byteLength < BATCH_HEADER_BYTES || view.getUint8(0) !== MSG_SNAPSHOTS) {
      return;
    }
    const count = view.getUint16(1, true);
    const entry = BATCH_ENTRY_HEADER_BYTES + SNAPSHOT_BYTES;
    if (data.byteLength < BATCH_HEADER_BYTES + count * entry) {
      return;
    }
    for (let i = 0, o = BATCH_HEADER_BYTES; i < count; i++, o += entry) {
      this.on.snapshot(view.getUint16(o, true), data, o + BATCH_ENTRY_HEADER_BYTES);
    }
  }
}
