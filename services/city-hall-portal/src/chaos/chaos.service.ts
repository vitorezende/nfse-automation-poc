import { Injectable } from '@nestjs/common';

export interface ChaosSettings {
  /** Random extra latency added to every page, in milliseconds. */
  latencyMinMs: number;
  latencyMaxMs: number;
  /** Probability (0..1) that submitting the issuance form fails with HTTP 500 before anything is stored. */
  submitErrorProbability: number;
  /**
   * Probability (0..1) that the session is gone when the issuance form is submitted, sending the user back to
   * login. Never twice in a row for the same Prestador, so logging in again always lets the work continue.
   */
  sessionExpiryProbability: number;
  /**
   * Probability (0..1) of a "phantom timeout" on issuance: the NFS-e IS issued and stored, but the response
   * never arrives. Only an RPS lookup before retrying avoids a duplicate (ADR 0002).
   */
  phantomTimeoutProbability: number;
  /** Every page answers HTTP 200 with a "scheduled maintenance" notice. */
  maintenance: boolean;
  /** The login form asks a simple arithmetic captcha. */
  captcha: boolean;
}

export const NO_CHAOS: ChaosSettings = {
  latencyMinMs: 0,
  latencyMaxMs: 0,
  submitErrorProbability: 0,
  sessionExpiryProbability: 0,
  phantomTimeoutProbability: 0,
  maintenance: false,
  captcha: false,
};

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

  private readonly justExpired = new Set<number>();

  /** Decides whether this Prestador's session expires now; never twice in a row for the same Prestador. */
  expireSession(prestadorId: number): boolean {
    if (this.justExpired.delete(prestadorId)) return false;
    if (!this.roll(this.settings.sessionExpiryProbability)) return false;
    this.justExpired.add(prestadorId);
    return true;
  }

  roll(probability: number): boolean {
    return probability > 0 && Math.random() < probability;
  }
}
