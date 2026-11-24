/**
 * OAuth Manager Service
 * Handles interactive Google OAuth flows initiated from the Admin Dashboard.
 */

import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { authorizeAntigravity, exchangeAntigravity } from '../lib/antigravity/oauth.js';
import { accountService } from './account-manager.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger('oauth-service');

const OAUTH_CALLBACK_PORT = parseInt(process.env.OAUTH_CALLBACK_PORT || '51121', 10);
const SESSION_TTL_MS = 30 * 60 * 1000;

export interface OAuthSession {
  sessionId: string;
  state: string;
  url: string;
  status: 'pending' | 'success' | 'error';
  email?: string;
  projectId?: string;
  error?: string;
  allowedModels?: string[];
  createdAt: number;
}

export interface StartOAuthOptions {
  projectId?: string;
  allowedModels?: string[];
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderCallbackPage(options: {
  success: boolean;
  title: string;
  message: string;
  adminPort: number;
}): string {
  const accent = options.success ? '#10b981' : '#ef4444';
  const adminUrl = `http://localhost:${options.adminPort}/admin`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(options.title)}</title>
  <style>
    body {
      margin: 0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #0f1117;
      color: #e2e8f0;
      font-family: -apple-system, BlinkMacSystemFont, 'Inter', sans-serif;
    }
    .card {
      background: #1e212b;
      border: 1px solid #2d3748;
      border-radius: 16px;
      padding: 36px 40px;
      max-width: 460px;
      text-align: center;
      box-shadow: 0 20px 40px rgba(0, 0, 0, 0.45);
    }
    .icon {
      font-size: 48px;
      margin-bottom: 16px;
    }
    h1 {
      margin: 0 0 12px;
      font-size: 1.5rem;
      color: ${accent};
    }
    p {
      margin: 0 0 24px;
      color: #94a3b8;
      line-height: 1.5;
    }
    a {
      display: inline-block;
      padding: 10px 20px;
      background: #6366f1;
      color: #fff;
      text-decoration: none;
      border-radius: 8px;
      font-weight: 500;
    }
    a:hover { background: #4f46e5; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">${options.success ? '✅' : '❌'}</div>
    <h1>${escapeHtml(options.title)}</h1>
    <p>${escapeHtml(options.message)}</p>
    <a href="${escapeHtml(adminUrl)}">Return to Dashboard</a>
  </div>
  ${options.success ? '<script>setTimeout(() => window.close(), 1800);</script>' : ''}
</body>
</html>`;
}

class OAuthService {
  private sessions = new Map<string, OAuthSession>();
  private stateToSessionId = new Map<string, string>();
  private callbackServer: http.Server | null = null;
  private callbackListening = false;

  private cleanupExpiredSessions(): void {
    const now = Date.now();
    for (const [id, session] of this.sessions.entries()) {
      if (now - session.createdAt > SESSION_TTL_MS) {
        this.sessions.delete(id);
        this.stateToSessionId.delete(session.state);
      }
    }
  }

  private async ensureCallbackServer(): Promise<boolean> {
    if (this.callbackServer && this.callbackListening) {
      return true;
    }

    const adminPort = parseInt(process.env.PORT || '3000', 10);

    return new Promise<boolean>((resolve) => {
      const server = http.createServer(async (req, res) => {
        try {
          const reqUrl = new URL(req.url || '/', `http://localhost:${OAUTH_CALLBACK_PORT}`);

          if (reqUrl.pathname !== '/oauth-callback') {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Not found');
            return;
          }

          const code = reqUrl.searchParams.get('code');
          const state = reqUrl.searchParams.get('state');
          const error = reqUrl.searchParams.get('error');

          if (error) {
            if (state) {
              const sid = this.stateToSessionId.get(state);
              const session = sid ? this.sessions.get(sid) : undefined;
              if (session) {
                session.status = 'error';
                session.error = `Google OAuth error: ${error}`;
              }
            }
            res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(
              renderCallbackPage({
                success: false,
                title: 'Authentication Failed',
                message: `Google returned an error: ${error}`,
                adminPort,
              }),
            );
            return;
          }

          if (!code || !state) {
            res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(
              renderCallbackPage({
                success: false,
                title: 'Invalid Callback',
                message: 'Missing OAuth code or state parameter.',
                adminPort,
              }),
            );
            return;
          }

          const result = await this.completeOAuthCallback({ code, state });

          if (!result.success) {
            res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(
              renderCallbackPage({
                success: false,
                title: 'Authentication Failed',
                message: result.error || 'Token exchange failed.',
                adminPort,
              }),
            );
            return;
          }

          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(
            renderCallbackPage({
              success: true,
              title: 'Account Added Successfully!',
              message: `${result.email || 'Google account'} has been connected and activated in the proxy. You can close this tab.`,
              adminPort,
            }),
          );
        } catch (err) {
          log.error('Unhandled error in OAuth callback handler', { error: String(err) });
          res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(
            renderCallbackPage({
              success: false,
              title: 'Authentication Error',
              message: err instanceof Error ? err.message : 'Unexpected server error.',
              adminPort,
            }),
          );
        }
      });

      server.on('error', (err) => {
        log.warn('Could not bind OAuth callback server; manual callback fallback still available', {
          port: OAUTH_CALLBACK_PORT,
          error: String(err),
        });
        this.callbackListening = false;
        this.callbackServer = null;
        resolve(false);
      });

      server.listen(OAUTH_CALLBACK_PORT, '0.0.0.0', () => {
        this.callbackServer = server;
        this.callbackListening = true;
        log.info('OAuth callback server listening', {
          host: '0.0.0.0',
          port: OAUTH_CALLBACK_PORT,
        });
        resolve(true);
      });
    });
  }

  async startOAuthFlow(options: StartOAuthOptions = {}): Promise<{
    sessionId: string;
    url: string;
    callbackListening: boolean;
    callbackPort: number;
  }> {
    this.cleanupExpiredSessions();

    const callbackListening = await this.ensureCallbackServer();
    const { url } = await authorizeAntigravity(options.projectId?.trim() || '');
    const parsedUrl = new URL(url);
    const state = parsedUrl.searchParams.get('state') || '';

    const sessionId = randomUUID();
    const session: OAuthSession = {
      sessionId,
      state,
      url,
      status: 'pending',
      allowedModels: options.allowedModels !== undefined ? [...options.allowedModels] : undefined,
      createdAt: Date.now(),
    };

    this.sessions.set(sessionId, session);
    if (state) {
      this.stateToSessionId.set(state, sessionId);
    }

    log.info('Started admin OAuth session', {
      sessionId,
      callbackListening,
      callbackPort: OAUTH_CALLBACK_PORT,
    });

    return {
      sessionId,
      url,
      callbackListening,
      callbackPort: OAUTH_CALLBACK_PORT,
    };
  }

  getSessionStatus(sessionId: string): OAuthSession | null {
    this.cleanupExpiredSessions();
    return this.sessions.get(sessionId) ?? null;
  }

  async completeOAuthCallback(input: {
    code: string;
    state: string;
    sessionId?: string;
  }): Promise<{
    success: boolean;
    email?: string;
    projectId?: string;
    error?: string;
  }> {
    const resolvedSessionId =
      input.sessionId || this.stateToSessionId.get(input.state);
    const session = resolvedSessionId
      ? this.sessions.get(resolvedSessionId)
      : undefined;

    try {
      const result = await exchangeAntigravity(input.code, input.state);

      if (result.type === 'failed') {
        if (session) {
          session.status = 'error';
          session.error = result.error;
        }
        log.error('OAuth token exchange failed', { error: result.error });
        return { success: false, error: result.error };
      }

      const saved = await accountService.addOrUpdateAccount({
        email: result.email,
        refresh: result.refresh,
        access: result.access,
        expires: result.expires,
        projectId: result.projectId || undefined,
        allowedModels: session?.allowedModels,
      });

      if (session) {
        session.status = 'success';
        session.email = saved.email;
        session.projectId = result.projectId || saved.parts.projectId;
      }

      log.info('OAuth account connected from Admin Dashboard', {
        email: saved.email,
        index: saved.index,
      });

      return {
        success: true,
        email: saved.email,
        projectId: result.projectId || saved.parts.projectId,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (session) {
        session.status = 'error';
        session.error = message;
      }
      log.error('Error completing OAuth callback', { error: message });
      return { success: false, error: message };
    }
  }

  async completeFromCallbackUrl(
    callbackUrl: string,
    sessionId?: string,
  ): Promise<{
    success: boolean;
    email?: string;
    projectId?: string;
    error?: string;
  }> {
    let parsed: URL;
    try {
      parsed = new URL(callbackUrl.trim());
    } catch {
      return {
        success: false,
        error: 'Invalid callback URL. Paste the full http://localhost:51121/oauth-callback?... URL.',
      };
    }

    const code = parsed.searchParams.get('code');
    const state = parsed.searchParams.get('state');
    const error = parsed.searchParams.get('error');

    if (error) {
      return { success: false, error: `OAuth error: ${error}` };
    }

    if (!code || !state) {
      return {
        success: false,
        error: 'Callback URL is missing required code or state query parameters.',
      };
    }

    return this.completeOAuthCallback({ code, state, sessionId });
  }

  async shutdown(): Promise<void> {
    if (!this.callbackServer) {
      return;
    }

    await new Promise<void>((resolve) => {
      this.callbackServer?.close(() => {
        this.callbackServer = null;
        this.callbackListening = false;
        resolve();
      });
    });
  }
}

export const oauthService = new OAuthService();
