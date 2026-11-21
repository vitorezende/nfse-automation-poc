import { Injectable } from '@nestjs/common';

export interface ChaosSettings {
  /** Random extra latency added to every page, in milliseconds. */
  latencyMinMs: number;
  latencyMaxMs: number;
  /** Probability (0..1) that submitting the issuance form fails with HTTP 500 before anything is stored. */
  submitErrorProbability: number;
}

export const NO_CHAOS: ChaosSettings = { latencyMinMs: 0, latencyMaxMs: 0, submitErrorProbability: 0 };

/** Runtime-adjustable failure injection, so the demo can show the robot recovering. In memory, single instance. */
@Injectable()
export class ChaosService {
  private settings: ChaosSettings = { ...NO_CHAOS };

  current(): ChaosSettings {
    return { ...this.settings };
  }

  update(next: ChaosSettings): void {
    this.settings = { ...next };
  }

  latencyMs(): number {
    const { latencyMinMs: min, latencyMaxMs: max } = this.settings;
    return max <= 0 ? 0 : min + Math.random() * Math.max(0, max - min);
  }

  roll(probability: number): boolean {
    return probability > 0 && Math.random() < probability;
  }
}
