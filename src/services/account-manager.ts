/**
 * Account Manager Service
 * Manages OAuth accounts, rotation, per-account model selection, and rate limiting
 */

import { AccountManager, type ManagedAccount } from '../lib/auth/accounts.js';
import { formatRefreshParts } from '../lib/auth/auth.js';
import { loadAccounts } from '../lib/auth/storage.js';
import { createLogger } from '../lib/logger.js';
import type { OAuthAuthDetails } from '../lib/types.js';

const log = createLogger('account-service');

export interface AddAccountInput {
  email?: string;
  refresh: string;
  access?: string;
  expires?: number;
  projectId?: string;
  allowedModels?: string[];
}

export class AccountService {
  private accountManager: AccountManager | null = null;
  private initialized = false;

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // Load accounts from disk
      const stored = await loadAccounts();

      if (!stored || !stored.accounts || stored.accounts.length === 0) {
        log.warn('No accounts found. Add an account via Admin Dashboard or run: npm run auth');
        this.accountManager = new AccountManager();
        this.initialized = true;
        return;
      }

      // Create a dummy auth object from the first account to initialize AccountManager
      const firstAccount = stored.accounts[0];
      if (!firstAccount) {
        this.accountManager = new AccountManager();
        this.initialized = true;
        return;
      }

      const dummyAuth: OAuthAuthDetails = {
        type: 'oauth',
        refresh: formatRefreshParts({
          refreshToken: firstAccount.refreshToken,
          projectId: firstAccount.projectId,
          managedProjectId: firstAccount.managedProjectId,
        }),
        access: '', // Will be refreshed when needed
        expires: 0,
      };

      this.accountManager = await AccountManager.loadFromDisk(dummyAuth);
      this.initialized = true;

      log.info('Account manager initialized', {
        accountCount: this.accountManager.getAccountCount(),
      });
    } catch (error) {
      log.error('Failed to initialize account manager', {
        error: String(error),
      });
      throw error;
    }
  }

  private async ensureManager(): Promise<AccountManager> {
    if (!this.initialized) {
      await this.initialize();
    }

    if (!this.accountManager) {
      this.accountManager = new AccountManager();
    }

    return this.accountManager;
  }

  async getAccountManager(): Promise<AccountManager> {
    const manager = await this.ensureManager();

    if (manager.getAccountCount() === 0) {
      throw new Error('No accounts configured. Add an account via Admin Dashboard or run authentication first.');
    }

    return manager;
  }

  async getAccountCount(): Promise<number> {
    const manager = await this.ensureManager();
    return manager.getAccountCount();
  }

  async getAccounts(): Promise<ManagedAccount[]> {
    const manager = await this.ensureManager();
    return manager.getAccounts();
  }

  async hasEligibleAccountForModel(model: string): Promise<boolean> {
    const manager = await this.ensureManager();
    return manager.hasEligibleAccountForModel(model);
  }

  async addOrUpdateAccount(input: AddAccountInput): Promise<ManagedAccount> {
    const manager = await this.ensureManager();
    const account = manager.addOrUpdateAccount(input);
    await manager.saveToDisk({ overwrite: true });

    log.info('Account saved via AccountService', {
      email: account.email,
      index: account.index,
      totalAccounts: manager.getAccountCount(),
    });

    return account;
  }

  async setAccountModels(
    accountIndex: number,
    allowedModels: string[] | undefined,
  ): Promise<ManagedAccount | null> {
    const manager = await this.ensureManager();
    const updated = manager.setAllowedModels(accountIndex, allowedModels);
    if (!updated) {
      return null;
    }

    await manager.saveToDisk({ overwrite: true });

    log.info('Updated allowed models for account', {
      index: accountIndex,
      email: updated.email,
      allowedModels: allowedModels ?? 'all',
    });

    return updated;
  }

  async removeAccount(accountIndex: number): Promise<boolean> {
    const manager = await this.ensureManager();
    const removed = manager.removeAccountByIndex(accountIndex);
    if (!removed) {
      return false;
    }

    await manager.saveToDisk({ overwrite: true });

    log.info('Removed account', {
      index: accountIndex,
      remainingAccounts: manager.getAccountCount(),
    });

    return true;
  }

  async getNextAccount(model: string): Promise<ManagedAccount | null> {
    const manager = await this.getAccountManager();

    // Determine model family from model name
    const family = model.toLowerCase().includes('claude') ? 'claude' : 'gemini';
    const headerStyle = model.toLowerCase().includes('antigravity') ? 'antigravity' : 'gemini-cli';

    return manager.getCurrentOrNextForFamily(
      family as 'claude' | 'gemini',
      model,
      'hybrid', // Default strategy
      headerStyle as 'antigravity' | 'gemini-cli',
      false, // pid_offset_enabled
    );
  }

  async markRateLimited(account: ManagedAccount, delayMs: number, model: string): Promise<void> {
    const manager = await this.getAccountManager();
    const family = model.toLowerCase().includes('claude') ? 'claude' : 'gemini';
    const headerStyle = model.toLowerCase().includes('antigravity') ? 'antigravity' : 'gemini-cli';

    manager.markRateLimited(
      account,
      delayMs,
      family as 'claude' | 'gemini',
      headerStyle as 'antigravity' | 'gemini-cli',
      model
    );

    await manager.saveToDisk();
  }

  async saveToDisk(): Promise<void> {
    if (this.accountManager) {
      await this.accountManager.saveToDisk();
    }
  }
}

// Singleton instance
export const accountService = new AccountService();
