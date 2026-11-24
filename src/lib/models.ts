/**
 * Shared model definitions and fallback catalog exposed by the proxy.
 */

export interface ModelQuotaInfo {
  remainingFraction?: number;
  resetTime?: string;
}

export interface ProxyModelDefinition {
  id: string;
  object: 'model';
  created: number;
  owned_by: string;
  displayName: string;
  family: 'gemini' | 'claude' | 'openai' | 'other';
  maxTokens?: number;
  maxOutputTokens?: number;
  supportsThinking?: boolean;
  supportsImages?: boolean;
  recommended?: boolean;
  tagTitle?: string;
  quota?: ModelQuotaInfo;
  source?: 'live' | 'fallback';
}

export const FALLBACK_MODELS: readonly ProxyModelDefinition[] = [
  {
    id: 'antigravity-gemini-3-pro',
    object: 'model',
    created: 1700000000,
    owned_by: 'google-antigravity',
    displayName: 'Gemini 3 Pro (Antigravity)',
    family: 'gemini',
    source: 'fallback',
  },
  {
    id: 'antigravity-gemini-3-flash',
    object: 'model',
    created: 1700000000,
    owned_by: 'google-antigravity',
    displayName: 'Gemini 3 Flash (Antigravity)',
    family: 'gemini',
    source: 'fallback',
  },
  {
    id: 'antigravity-claude-sonnet-4-5',
    object: 'model',
    created: 1700000000,
    owned_by: 'google-antigravity',
    displayName: 'Claude Sonnet 4.5 (Antigravity)',
    family: 'claude',
    source: 'fallback',
  },
  {
    id: 'antigravity-claude-sonnet-4-5-thinking',
    object: 'model',
    created: 1700000000,
    owned_by: 'google-antigravity',
    displayName: 'Claude Sonnet 4.5 Thinking (Antigravity)',
    family: 'claude',
    source: 'fallback',
  },
  {
    id: 'antigravity-claude-opus-4-5-thinking',
    object: 'model',
    created: 1700000000,
    owned_by: 'google-antigravity',
    displayName: 'Claude Opus 4.5 Thinking (Antigravity)',
    family: 'claude',
    source: 'fallback',
  },
  {
    id: 'gemini-2.5-flash',
    object: 'model',
    created: 1700000000,
    owned_by: 'google-gemini-cli',
    displayName: 'Gemini 2.5 Flash (CLI)',
    family: 'gemini',
    source: 'fallback',
  },
  {
    id: 'gemini-2.5-pro',
    object: 'model',
    created: 1700000000,
    owned_by: 'google-gemini-cli',
    displayName: 'Gemini 2.5 Pro (CLI)',
    family: 'gemini',
    source: 'fallback',
  },
];

export const AVAILABLE_MODELS = FALLBACK_MODELS;
export const AVAILABLE_MODEL_IDS = new Set(FALLBACK_MODELS.map((m) => m.id));
