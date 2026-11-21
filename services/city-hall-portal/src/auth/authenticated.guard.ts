import { ArgumentsHost, CanActivate, Catch, ExceptionFilter, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';

export class NotAuthenticatedException extends Error {}

/** Lets a request through only when the cookie session belongs to a logged-in Prestador. */
@Injectable()
export class AuthenticatedGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (request.session.prestadorId) return true;
    throw new NotAuthenticatedException();
  }
}

/** Unauthenticated (or expired) sessions land on the login page, as on a classic portal. */
@Catch(NotAuthenticatedException)
export class RedirectToLoginFilter implements ExceptionFilter {
  catch(_exception: NotAuthenticatedException, host: ArgumentsHost): void {
    host.switchToHttp().getResponse<Response>().redirect('/login');
  }
}
