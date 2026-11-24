/**
 * Dynamic Model Discovery Service
 * Fetches live available models and quota metadata per account from Antigravity API
 * via /v1internal:fetchAvailableModels, with caching and fallback support.
 */

import {
  ANTIGRAVITY_DEFAULT_PROJECT_ID,
  ANTIGRAVITY_ENDPOINT_FALLBACKS,
  ANTIGRAVITY_HEADERS,
} from '../lib/constants.js';
import { accessTokenExpired } from '../lib/auth/auth.js';
import { refreshAccessToken } from '../lib/auth/token.js';
import { FALLBACK_MODELS, type ProxyModelDefinition } from '../lib/models.js';
import { accountService } from './account-manager.js';
import { createLogger } from '../lib/logger.js';
import type { ManagedAccount } from '../lib/auth/accounts.js';

const log = createLogger('model-service');

const MODEL_CACHE_TTL_MS = 5 * 60 * 1000;
const FETCH_TIMEOUT_MS = 10_000;

export interface AccountModelsResult {
  models: ProxyModelDefinition[];
  source: 'live' | 'fallback';
  fetchedAt: number;
  defaultModelId?: string;
  error?: string;
}

interface RawRemoteModel {
  displayName?: string;
  supportsImages?: boolean;
  supportsThinking?: boolean;
  recommended?: boolean;
  isInternal?: boolean;
  maxTokens?: number;
  maxOutputTokens?: number;
  modelProvider?: string;
  tagTitle?: string;
  quotaInfo?: {
    remainingFraction?: number;
    resetTime?: string;
  };
}

interface FetchAvailableModelsResponse {
  models?: Record<string, RawRemoteModel>;
  defaultAgentModelId?: string;
}

function mapProvider(
  modelId: string,
  modelProvider?: string,
): { owned_by: string; family: ProxyModelDefinition['family'] } {
  const providerUpper = (modelProvider || '').toUpperCase();
  const idLower = modelId.toLowerCase();

  if (providerUpper.includes('ANTHROPIC') || idLower.includes('claude')) {
    return { owned_by: 'anthropic', family: 'claude' };
  }
  if (providerUpper.includes('OPENAI') || idLower.startsWith('gpt-')) {
    return { owned_by: 'openai', family: 'openai' };
  }
  if (providerUpper.includes('GOOGLE') || idLower.includes('gemini')) {
    return { owned_by: 'google', family: 'gemini' };
  }
  return { owned_by: 'google-antigravity', family: 'other' };
}

function shouldIncludeRemoteModel(id: string, raw: RawRemoteModel): boolean {
  if (!id || typeof raw !== 'object' || !raw) {
    return false;
  }
  if (raw.isInternal === true) {
    return false;
  }
  // Skip internal IDE tab-autocomplete models without a user-facing displayName
  if (id.startsWith('tab_') && !raw.displayName) {
    return false;
  }
  return true;
}

function normalizeRemoteModels(data: FetchAvailableModelsResponse): ProxyModelDefinition[] {
  const rawModels = data.models || {};
  const created = Math.floor(Date.now() / 1000);
  const models: ProxyModelDefinition[] = [];

  for (const [id, raw] of Object.entries(rawModels)) {
    if (!shouldIncludeRemoteModel(id, raw)) {
      continue;
    }

    const { owned_by, family } = mapProvider(id, raw.modelProvider);
    models.push({
      id,
      object: 'model',
      created,
      owned_by,
      displayName: raw.displayName || id,
      family,
      maxTokens: typeof raw.maxTokens === 'number' ? raw.maxTokens : undefined,
      maxOutputTokens: typeof raw.maxOutputTokens === 'number' ? raw.maxOutputTokens : undefined,
      supportsThinking: raw.supportsThinking === true,
      supportsImages: raw.supportsImages === true,
      recommended: raw.recommended === true,
      tagTitle: typeof raw.tagTitle === 'string' && raw.tagTitle ? raw.tagTitle : undefined,
      quota: raw.quotaInfo
        ? {
            remainingFraction:
              typeof raw.quotaInfo.remainingFraction === 'number'
                ? raw.quotaInfo.remainingFraction
                : undefined,
            resetTime:
              typeof raw.quotaInfo.resetTime === 'string'
                ? raw.quotaInfo.resetTime
                : undefined,
          }
        : undefined,
      source: 'live',
    });
  }

  models.sort((a, b) => {
    if (Boolean(a.recommended) !== Boolean(b.recommended)) {
      return a.recommended ? -1 : 1;
    }
    const familyOrder: Record<ProxyModelDefinition['family'], number> = {
      claude: 0,
      gemini: 1,
      openai: 2,
      other: 3,
    };
    const famDiff = familyOrder[a.family] - familyOrder[b.family];
    if (famDiff !== 0) {
      return famDiff;
    }
    return a.displayName.localeCompare(b.displayName) || a.id.localeCompare(b.id);
  });

  return models;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = FETCH_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

class ModelService {
  private accountCache = new Map<string, AccountModelsResult>();
  private knownAntigravityModels = new Set<string>();

  private getCacheKey(account: ManagedAccount): string {
    return account.parts.refreshToken || account.email || String(account.index);
  }

  invalidateCache(account?: ManagedAccount): void {
    if (account) {
      this.accountCache.delete(this.getCacheKey(account));
    } else {
      this.accountCache.clear();
    }
  }

  isKnownAntigravityModel(modelId: string): boolean {
    const cleaned = modelId.replace(/^antigravity-/, '').replace(/:antigravity$/, '');
    return this.knownAntigravityModels.has(modelId) || this.knownAntigravityModels.has(cleaned);
  }

  private async getValidAccessToken(account: ManagedAccount): Promise<string> {
    const manager = await accountService.getAccountManager();
    let auth = manager.toAuthDetails(account);

    if (accessTokenExpired(auth)) {
      const refreshed = await refreshAccessToken(auth);
      if (!refreshed || !refreshed.access) {
        throw new Error('Failed to refresh OAuth access token');
      }
      manager.updateFromAuth(account, refreshed);
      await manager.saveToDisk();
      auth = refreshed;
    }

    if (!auth.access) {
      throw new Error('Missing OAuth access token');
    }

    return auth.access;
  }

  private async fetchLiveModelsForAccount(
    account: ManagedAccount,
  ): Promise<{ models: ProxyModelDefinition[]; defaultModelId?: string }> {
    const accessToken = await this.getValidAccessToken(account);
    const project =
      account.parts.projectId ||
      account.parts.managedProjectId ||
      ANTIGRAVITY_DEFAULT_PROJECT_ID;

    const errors: string[] = [];

    for (const baseEndpoint of ANTIGRAVITY_ENDPOINT_FALLBACKS) {
      try {
        const url = `${baseEndpoint}/v1internal:fetchAvailableModels`;
        const response = await fetchWithTimeout(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            ...ANTIGRAVITY_HEADERS,
          },
          body: JSON.stringify({ project }),
        });

        if (!response.ok) {
          const errText = await response.text().catch(() => '');
          errors.push(`${baseEndpoint} HTTP ${response.status}: ${errText.slice(0, 150)}`);
          continue;
        }

        const payload = (await response.json()) as FetchAvailableModelsResponse;
        const models = normalizeRemoteModels(payload);

        if (models.length === 0) {
          errors.push(`${baseEndpoint} returned 0 models`);
          continue;
        }

        for (const model of models) {
          this.knownAntigravityModels.add(model.id);
        }

        log.info('Fetched live models for account', {
          email: account.email,
          endpoint: baseEndpoint,
          count: models.length,
        });

        return {
          models,
          defaultModelId: payload.defaultAgentModelId,
        };
      } catch (err) {
        errors.push(`${baseEndpoint}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    throw new Error(`Unable to fetch live models (${errors.join('; ')})`);
  }

  async getModelsForAccount(
    accountIndex: number,
    options: { forceRefresh?: boolean } = {},
  ): Promise<AccountModelsResult> {
    const accounts = await accountService.getAccounts();
    const account = accounts[accountIndex];

    if (!account) {
      throw new Error('Account not found');
    }

    const cacheKey = this.getCacheKey(account);
    const cached = this.accountCache.get(cacheKey);
    const now = Date.now();

    if (
      !options.forceRefresh &&
      cached &&
      cached.source === 'live' &&
      now - cached.fetchedAt < MODEL_CACHE_TTL_MS
    ) {
      return cached;
    }

    try {
      const live = await this.fetchLiveModelsForAccount(account);
      const result: AccountModelsResult = {
        models: live.models,
        source: 'live',
        fetchedAt: now,
        defaultModelId: live.defaultModelId,
      };
      this.accountCache.set(cacheKey, result);
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.warn('Falling back to static model catalog for account', {
        email: account.email,
        error: message,
      });

      return {
        models: [...FALLBACK_MODELS],
        source: 'fallback',
        fetchedAt: now,
        error: message,
      };
    }
  }

  async getCatalogModels(
    options: { forceRefresh?: boolean } = {},
  ): Promise<AccountModelsResult> {
    const accounts = await accountService.getAccounts();
    const now = Date.now();

    if (accounts.length === 0) {
      return {
        models: [...FALLBACK_MODELS],
        source: 'fallback',
        fetchedAt: now,
      };
    }

    const merged = new Map<string, ProxyModelDefinition>();
    let liveFound = false;
    let defaultModelId: string | undefined;
    let lastError: string | undefined;

    for (let i = 0; i < accounts.length; i++) {
      try {
        const res = await this.getModelsForAccount(i, options);
        if (res.source === 'live') {
          liveFound = true;
          if (!defaultModelId && res.defaultModelId) {
            defaultModelId = res.defaultModelId;
          }
          for (const model of res.models) {
            if (!merged.has(model.id)) {
              merged.set(model.id, model);
            }
          }
        } else if (res.error) {
          lastError = res.error;
        }
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
      }
    }

    if (liveFound && merged.size > 0) {
      return {
        models: Array.from(merged.values()),
        source: 'live',
        fetchedAt: now,
        defaultModelId,
      };
    }

    return {
      models: [...FALLBACK_MODELS],
      source: 'fallback',
      fetchedAt: now,
      error: lastError,
    };
  }
}

export const modelService = new ModelService();
