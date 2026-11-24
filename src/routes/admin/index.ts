/**
 * Admin Dashboard Routes
 */

import type { FastifyInstance } from 'fastify';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { accountService } from '../../services/account-manager.js';
import { oauthService } from '../../services/oauth-service.js';
import { modelService } from '../../services/model-service.js';
import { metricsService } from '../../services/metrics-collector.js';
import { logService } from '../../services/log-store.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function sanitizeAllowedModels(input: unknown): string[] | undefined {
  if (input === null || input === undefined) {
    return undefined;
  }
  if (!Array.isArray(input)) {
    throw new Error('allowedModels must be an array of model IDs or null');
  }
  const unique = new Set<string>();
  for (const item of input) {
    if (typeof item === 'string' && item.trim().length > 0) {
      unique.add(item.trim());
    }
  }
  return Array.from(unique);
}

export default async function adminRoutes(server: FastifyInstance) {
  // Serve dashboard HTML
  server.get('/', async (_request, reply) => {
    const htmlPath = join(__dirname, '../../dashboard/index.html');
    const html = readFileSync(htmlPath, 'utf-8');
    return reply.type('text/html').send(html);
  });

  // Get live available models catalog (merged across connected accounts, with fallback)
  server.get<{ Querystring: { refresh?: string } }>(
    '/api/models',
    async (request) => {
      const forceRefresh = request.query?.refresh === 'true' || request.query?.refresh === '1';
      return modelService.getCatalogModels({ forceRefresh });
    },
  );

  // Get accounts status
  server.get('/api/accounts', async () => {
    try {
      const accounts = await accountService.getAccounts();
      const now = Date.now();

      return {
        accounts: accounts.map(acc => ({
          index: acc.index,
          email: acc.email || `Account ${acc.index + 1}`,
          projectId: acc.parts.projectId || acc.parts.managedProjectId || null,
          addedAt: acc.addedAt,
          lastUsed: acc.lastUsed,
          rateLimitResetTimes: acc.rateLimitResetTimes,
          isRateLimited: Object.values(acc.rateLimitResetTimes).some(t => (t ?? 0) > now),
          coolingDownUntil: acc.coolingDownUntil,
          cooldownReason: acc.cooldownReason,
          allowedModels: acc.allowedModels ?? null,
        })),
      };
    } catch (error) {
      return {
        error: String(error),
        accounts: [],
      };
    }
  });

  // Get live available models & quotas for a specific account
  server.get<{
    Params: { index: string };
    Querystring: { refresh?: string };
  }>('/api/accounts/:index/models', async (request, reply) => {
    const accountIndex = Number.parseInt(request.params.index, 10);
    if (!Number.isInteger(accountIndex) || accountIndex < 0) {
      return reply.status(400).send({ error: 'Invalid account index' });
    }

    const accounts = await accountService.getAccounts();
    const account = accounts[accountIndex];
    if (!account) {
      return reply.status(404).send({ error: 'Account not found' });
    }

    const forceRefresh = request.query?.refresh === 'true' || request.query?.refresh === '1';
    const result = await modelService.getModelsForAccount(accountIndex, { forceRefresh });

    return {
      account: {
        index: account.index,
        email: account.email || `Account ${account.index + 1}`,
        allowedModels: account.allowedModels ?? null,
      },
      ...result,
    };
  });

  // Start Google OAuth flow to add an account from the dashboard
  server.post<{
    Body: { projectId?: string; allowedModels?: string[] | null };
  }>('/api/accounts/oauth/start', async (request, reply) => {
    try {
      const body = request.body || {};
      const allowedModels = sanitizeAllowedModels(body.allowedModels);
      const result = await oauthService.startOAuthFlow({
        projectId: typeof body.projectId === 'string' ? body.projectId : undefined,
        allowedModels,
      });

      return result;
    } catch (error) {
      return reply.status(400).send({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // Check status of an active OAuth session
  server.get<{ Params: { sessionId: string } }>(
    '/api/accounts/oauth/status/:sessionId',
    async (request, reply) => {
      const session = oauthService.getSessionStatus(request.params.sessionId);
      if (!session) {
        return reply.status(404).send({
          error: 'OAuth session not found or expired',
        });
      }

      return {
        sessionId: session.sessionId,
        status: session.status,
        email: session.email,
        projectId: session.projectId,
        error: session.error,
      };
    },
  );

  // Manual fallback to complete OAuth by pasting the callback URL or code/state
  server.post<{
    Body: {
      sessionId?: string;
      callbackUrl?: string;
      code?: string;
      state?: string;
    };
  }>('/api/accounts/oauth/complete', async (request, reply) => {
    const body = request.body || {};

    let result;
    if (typeof body.callbackUrl === 'string' && body.callbackUrl.trim()) {
      result = await oauthService.completeFromCallbackUrl(body.callbackUrl, body.sessionId);
    } else if (typeof body.code === 'string' && typeof body.state === 'string') {
      result = await oauthService.completeOAuthCallback({
        code: body.code.trim(),
        state: body.state.trim(),
        sessionId: body.sessionId,
      });
    } else {
      return reply.status(400).send({
        success: false,
        error: 'Provide callbackUrl or both code and state',
      });
    }

    if (!result.success) {
      return reply.status(400).send(result);
    }

    modelService.invalidateCache();
    return result;
  });

  // Update allowed models for a specific account
  server.put<{
    Params: { index: string };
    Body: { allowedModels?: string[] | null };
  }>('/api/accounts/:index/models', async (request, reply) => {
    const accountIndex = Number.parseInt(request.params.index, 10);
    if (!Number.isInteger(accountIndex) || accountIndex < 0) {
      return reply.status(400).send({ error: 'Invalid account index' });
    }

    try {
      const allowedModels = sanitizeAllowedModels(request.body?.allowedModels);
      const updated = await accountService.setAccountModels(accountIndex, allowedModels);

      if (!updated) {
        return reply.status(404).send({ error: 'Account not found' });
      }

      return {
        success: true,
        account: {
          index: updated.index,
          email: updated.email || `Account ${updated.index + 1}`,
          allowedModels: updated.allowedModels ?? null,
        },
      };
    } catch (error) {
      return reply.status(400).send({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // Remove an account
  server.delete<{ Params: { index: string } }>(
    '/api/accounts/:index',
    async (request, reply) => {
      const accountIndex = Number.parseInt(request.params.index, 10);
      if (!Number.isInteger(accountIndex) || accountIndex < 0) {
        return reply.status(400).send({ error: 'Invalid account index' });
      }

      const removed = await accountService.removeAccount(accountIndex);
      if (!removed) {
        return reply.status(404).send({ error: 'Account not found' });
      }

      modelService.invalidateCache();
      return { success: true };
    },
  );

  // Get metrics
  server.get('/api/metrics', async () => {
    const stats = metricsService.getStats();
    const recentRequests = metricsService.getRecentRequests(100);

    return {
      stats,
      recentRequests,
    };
  });

  // Get logs
  server.get<{ Querystring: { limit?: string } }>(
    '/api/logs',
    async (request) => {
      const limit = parseInt(request.query.limit || '100', 10);
      const logs = logService.getRecentLogs(limit);

      return {
        logs,
        total: logs.length,
      };
    }
  );

  // Clear logs
  server.post('/api/logs/clear', async () => {
    logService.clearLogs();
    return { success: true };
  });
}
