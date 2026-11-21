import 'express-session';

declare module 'express-session' {
  interface SessionData {
    prestadorId: number;
    prestadorName: string;
    prestadorCnpj: string;
  }
}
