import { Injectable } from '@nestjs/common';
import { EventEmitter } from 'node:events';

/**
 * In-process notifications that a Solicitação changed, feeding the live timeline (SSE).
 * Single-instance by design for the POC; a multi-instance deployment would fan out via the broker.
 */
@Injectable()
export class IssuanceUpdates {
  private readonly emitter = new EventEmitter().setMaxListeners(0);

  notify(issuanceRequestId: string): void {
    this.emitter.emit('updated', issuanceRequestId);
  }

  subscribe(listener: (issuanceRequestId: string) => void): () => void {
    this.emitter.on('updated', listener);
    return () => this.emitter.off('updated', listener);
  }
}
