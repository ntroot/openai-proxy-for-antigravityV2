// Dashboard JavaScript

let refreshInterval;
let allLogs = [];
let allAccounts = [];
let availableModels = [];
let editingAccountIndex = null;
let editingAccountModels = [];
let editSelectedModelIds = new Set();
let activeOAuthSessionId = null;
let oauthPollInterval = null;
let toastTimer = null;

async function loadDashboard() {
  try {
    await Promise.all([
      loadModelsCatalog(),
      loadHealth(),
      loadAccounts(),
      loadMetrics(),
      loadLogs(),
    ]);
  } catch (error) {
    console.error('Failed to load dashboard:', error);
  }
}

async function loadModelsCatalog(forceRefresh = false) {
  if (!forceRefresh && availableModels.length > 0) return;
  try {
    const query = forceRefresh ? '?refresh=true' : '';
    const response = await fetch(`/admin/api/models${query}`);
    const data = await response.json();
    availableModels = data.models || [];
  } catch (error) {
    console.error('Failed to load models catalog:', error);
  }
}

async function loadHealth() {
  try {
    const response = await fetch('/health');
    const data = await response.json();

    document.getElementById('uptime').textContent = formatUptime(data.uptime);
    document.getElementById('totalRequests').textContent = data.stats?.totalRequests || 0;
    document.getElementById('successRate').textContent =
      (data.stats?.successRate || 0).toFixed(1) + '%';
  } catch (error) {
    console.error('Failed to load health:', error);
  }
}

async function loadAccounts() {
  try {
    const response = await fetch('/admin/api/accounts');
    const data = await response.json();
    allAccounts = data.accounts || [];

    const container = document.getElementById('accountsContainer');

    if (allAccounts.length === 0) {
      container.innerHTML =
        '<p class="muted">No accounts configured yet. Click <strong>+ Add Account</strong> to connect a Google account.</p>';
      return;
    }

    const now = Date.now();
    let html = '<div class="table-container"><table class="accounts-table"><thead><tr>';
    html += '<th>Email</th>';
    html += '<th>Status</th>';
    html += '<th>Allowed Models</th>';
    html += '<th>Last Used</th>';
    html += '<th>Rate Limited Until</th>';
    html += '<th>Actions</th>';
    html += '</tr></thead><tbody>';

    for (const account of allAccounts) {
      const isRateLimited = account.isRateLimited;
      const rateLimitResetTime = Object.values(account.rateLimitResetTimes || {})
        .filter(t => t > now)
        .sort()[0];

      html += '<tr>';
      html += `<td>${escapeHtml(account.email)}</td>`;
      html += `<td><span class="status-badge ${isRateLimited ? 'rate-limited' : 'active'}">${isRateLimited ? 'Rate Limited' : 'Active'}</span></td>`;
      html += `<td>${renderModelPills(account.allowedModels)}</td>`;
      html += `<td>${formatTimestamp(account.lastUsed)}</td>`;
      html += `<td>${rateLimitResetTime ? formatTimestamp(rateLimitResetTime) : '-'}</td>`;
      html += `<td>
        <div class="account-actions">
          <button class="btn btn-sm" onclick="openModelsModal(${account.index})">Models</button>
          <button class="btn btn-sm btn-danger" onclick="removeAccount(${account.index})">Remove</button>
        </div>
      </td>`;
      html += '</tr>';
    }

    html += '</tbody></table></div>';
    container.innerHTML = html;
  } catch (error) {
    console.error('Failed to load accounts:', error);
    document.getElementById('accountsContainer').innerHTML =
      '<p class="error">Failed to load accounts</p>';
  }
}

function renderModelPills(allowedModels) {
  if (allowedModels === null || allowedModels === undefined) {
    return '<div class="model-pills"><span class="model-pill all-models">All Models</span></div>';
  }

  if (allowedModels.length === 0) {
    return '<div class="model-pills"><span class="model-pill no-models">No Models (Paused)</span></div>';
  }

  const maxVisible = 4;
  const visible = allowedModels.slice(0, maxVisible);
  const remaining = allowedModels.length - visible.length;

  let pills = visible
    .map(modelId => `<span class="model-pill">${escapeHtml(modelId)}</span>`)
    .join('');

  if (remaining > 0) {
    pills += `<span class="model-pill">+${remaining} more</span>`;
  }

  return `<div class="model-pills">${pills}</div>`;
}

function formatTokenCount(n) {
  if (!n || typeof n !== 'number') return '';
  if (n >= 1000000) return `${(n / 1000000).toFixed(n % 1000000 === 0 ? 0 : 1)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}K`;
  return String(n);
}

function renderQuotaBadge(quota) {
  if (!quota || typeof quota.remainingFraction !== 'number') {
    return '';
  }
  const pct = Math.round(quota.remainingFraction * 100);
  const cls = pct >= 50 ? 'high' : pct >= 20 ? 'medium' : 'low';
  const title = quota.resetTime ? ` title="Resets at ${escapeHtml(new Date(quota.resetTime).toLocaleString())}"` : '';
  return `<span class="quota-badge ${cls}"${title}>${pct}% quota</span>`;
}

function renderModelOptionHtml(model, inputId, isChecked, onChangeHandler) {
  const specs = [];
  if (model.maxTokens) specs.push(`${formatTokenCount(model.maxTokens)} ctx`);
  if (model.maxOutputTokens) specs.push(`${formatTokenCount(model.maxOutputTokens)} out`);
  if (model.supportsThinking) specs.push('Thinking');
  if (model.supportsImages) specs.push('Vision');

  const tagHtml = model.tagTitle
    ? `<span class="model-tag-pill">${escapeHtml(model.tagTitle)}</span>`
    : '';
  const quotaHtml = renderQuotaBadge(model.quota);
  const changeAttr = onChangeHandler ? ` onchange="${onChangeHandler}"` : '';

  return `
    <label class="model-option" for="${inputId}">
      <div class="model-option-left">
        <input type="checkbox" id="${inputId}" value="${escapeHtml(model.id)}" ${isChecked ? 'checked' : ''}${changeAttr}>
        <div>
          <div class="model-option-name">${escapeHtml(model.displayName || model.id)} ${tagHtml}</div>
          <div class="model-option-meta">
            <span class="model-option-id">${escapeHtml(model.id)}</span>
            ${specs.length ? `<span class="model-spec">• ${escapeHtml(specs.join(' · '))}</span>` : ''}
          </div>
        </div>
      </div>
      <div class="model-option-right">
        ${quotaHtml}
        <span class="provider-tag">${escapeHtml(model.owned_by || 'custom')}</span>
      </div>
    </label>
  `;
}

// ============================================================================
// Add Account (OAuth) Modal
// ============================================================================

async function openAddAccountModal() {
  await loadModelsCatalog(true);
  stopOAuthPolling();
  activeOAuthSessionId = null;

  document.getElementById('oauthProjectId').value = '';
  document.getElementById('manualCallbackUrl').value = '';

  const allModelsCheckbox = document.getElementById('addAccountAllModels');
  allModelsCheckbox.checked = true;

  const listEl = document.getElementById('addAccountModelsList');
  listEl.innerHTML = availableModels.length > 0
    ? availableModels.map((m, idx) => renderModelOptionHtml(m, `add_model_${idx}`, true)).join('')
    : '<p class="muted">No models available.</p>';
  listEl.classList.add('hidden');

  const statusBox = document.getElementById('oauthStatusBox');
  statusBox.className = 'oauth-status hidden';
  statusBox.innerHTML = '';

  document.getElementById('oauthManualFallback').classList.add('hidden');

  const startBtn = document.getElementById('startOAuthBtn');
  startBtn.disabled = false;
  startBtn.textContent = 'Sign in with Google';

  document.getElementById('addAccountModal').style.display = 'block';
}

function closeAddAccountModal() {
  stopOAuthPolling();
  document.getElementById('addAccountModal').style.display = 'none';
}

function toggleAddAccountModels() {
  const checked = document.getElementById('addAccountAllModels').checked;
  const listEl = document.getElementById('addAccountModelsList');
  if (checked) {
    listEl.classList.add('hidden');
  } else {
    listEl.classList.remove('hidden');
  }
}

function getSelectedAddAccountModels() {
  const allChecked = document.getElementById('addAccountAllModels').checked;
  if (allChecked) {
    return null;
  }
  const checkboxes = document.querySelectorAll('#addAccountModelsList input[type="checkbox"]:checked');
  return Array.from(checkboxes).map(cb => cb.value);
}

async function startAddAccountOAuth() {
  const startBtn = document.getElementById('startOAuthBtn');
  const statusBox = document.getElementById('oauthStatusBox');
  const fallbackBox = document.getElementById('oauthManualFallback');

  const projectId = document.getElementById('oauthProjectId').value.trim();
  const allowedModels = getSelectedAddAccountModels();

  startBtn.disabled = true;
  startBtn.textContent = 'Starting OAuth...';

  try {
    const response = await fetch('/admin/api/accounts/oauth/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: projectId || undefined,
        allowedModels,
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Failed to start OAuth flow');
    }

    activeOAuthSessionId = data.sessionId;
    window.open(data.url, '_blank', 'noopener');

    statusBox.className = 'oauth-status pending';
    statusBox.innerHTML = `
      <div><strong>Waiting for Google sign-in...</strong></div>
      <div style="margin-top:6px;">
        Complete authentication in the opened browser tab.
        If it did not open, <a href="${escapeHtml(data.url)}" target="_blank" rel="noopener">click here to sign in with Google</a>.
      </div>
    `;

    fallbackBox.classList.remove('hidden');
    startBtn.textContent = 'Waiting for Google...';

    startOAuthPolling(data.sessionId);
  } catch (error) {
    statusBox.className = 'oauth-status error';
    statusBox.textContent = error.message || 'Failed to start OAuth flow';
    startBtn.disabled = false;
    startBtn.textContent = 'Sign in with Google';
  }
}

function startOAuthPolling(sessionId) {
  stopOAuthPolling();

  oauthPollInterval = setInterval(async () => {
    try {
      const response = await fetch(`/admin/api/accounts/oauth/status/${encodeURIComponent(sessionId)}`);
      if (!response.ok) {
        return;
      }

      const data = await response.json();
      if (data.status === 'success') {
        handleOAuthSuccess(data.email);
      } else if (data.status === 'error') {
        handleOAuthError(data.error || 'Authentication failed');
      }
    } catch (error) {
      console.error('OAuth status poll failed:', error);
    }
  }, 1500);
}

function stopOAuthPolling() {
  if (oauthPollInterval) {
    clearInterval(oauthPollInterval);
    oauthPollInterval = null;
  }
}

async function completeManualOAuth() {
  const input = document.getElementById('manualCallbackUrl');
  const callbackUrl = input.value.trim();
  if (!callbackUrl) {
    showToast('Please paste the callback URL first', 'error');
    return;
  }

  try {
    const response = await fetch('/admin/api/accounts/oauth/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: activeOAuthSessionId || undefined,
        callbackUrl,
      }),
    });

    const data = await response.json();
    if (!response.ok || !data.success) {
      throw new Error(data.error || 'Failed to complete authentication');
    }

    handleOAuthSuccess(data.email);
  } catch (error) {
    handleOAuthError(error.message || 'Failed to complete authentication');
  }
}

function handleOAuthSuccess(email) {
  stopOAuthPolling();
  const statusBox = document.getElementById('oauthStatusBox');
  statusBox.className = 'oauth-status success';
  statusBox.innerHTML = `<strong>Account added!</strong> ${escapeHtml(email || 'Google account')} is now active.`;

  const startBtn = document.getElementById('startOAuthBtn');
  startBtn.disabled = false;
  startBtn.textContent = 'Add Another Account';

  loadModelsCatalog(true);
  loadAccounts();
  loadHealth();
  showToast(`Account connected: ${email || 'Google account'}`, 'success');
}

function handleOAuthError(message) {
  stopOAuthPolling();
  const statusBox = document.getElementById('oauthStatusBox');
  statusBox.className = 'oauth-status error';
  statusBox.textContent = `Authentication failed: ${message}`;

  const startBtn = document.getElementById('startOAuthBtn');
  startBtn.disabled = false;
  startBtn.textContent = 'Retry Sign in with Google';
}

// ============================================================================
// Account Model Selection Modal (Dynamic Live Per-Account Models)
// ============================================================================

async function openModelsModal(accountIndex) {
  const account = allAccounts.find(a => a.index === accountIndex);
  if (!account) return;

  editingAccountIndex = accountIndex;
  document.getElementById('modelsModalTitle').textContent = `Model Selection — ${account.email}`;
  document.getElementById('modelsSearchInput').value = '';
  document.getElementById('customModelInput').value = '';
  document.getElementById('modelsSourceBadge').innerHTML = '<span class="muted">Fetching live models from Antigravity API...</span>';
  document.getElementById('editModelsList').innerHTML = '<p class="muted">Loading models...</p>';

  const isAllModels = account.allowedModels === null || account.allowedModels === undefined;
  document.getElementById('editAccountAllModels').checked = isAllModels;

  document.getElementById('modelsModal').style.display = 'block';
  await fetchAndRenderAccountModels(accountIndex, false, true);
}

async function refreshAccountModels() {
  if (editingAccountIndex === null) return;
  await fetchAndRenderAccountModels(editingAccountIndex, true, false);
}

async function fetchAndRenderAccountModels(accountIndex, forceRefresh, resetSelection) {
  const refreshBtn = document.getElementById('refreshModelsBtn');
  const sourceBadge = document.getElementById('modelsSourceBadge');
  const listEl = document.getElementById('editModelsList');

  refreshBtn.disabled = true;
  refreshBtn.textContent = 'Refreshing...';
  if (forceRefresh) {
    sourceBadge.innerHTML = '<span class="muted">Refreshing live models...</span>';
  }

  try {
    const query = forceRefresh ? '?refresh=true' : '';
    const response = await fetch(`/admin/api/accounts/${accountIndex}/models${query}`);
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Failed to load account models');
    }

    const remoteModels = data.models || [];
    const allowedModels = data.account?.allowedModels;
    const isAllModels = allowedModels === null || allowedModels === undefined;

    // Merge any previously saved custom model IDs not present in the remote list
    const knownIds = new Set(remoteModels.map(m => m.id));
    const mergedModels = [...remoteModels];
    if (Array.isArray(allowedModels)) {
      for (const customId of allowedModels) {
        if (!knownIds.has(customId)) {
          mergedModels.push({
            id: customId,
            displayName: customId,
            owned_by: 'custom',
            family: 'other',
          });
          knownIds.add(customId);
        }
      }
    }

    editingAccountModels = mergedModels;

    if (resetSelection) {
      document.getElementById('editAccountAllModels').checked = isAllModels;
      editSelectedModelIds = isAllModels
        ? new Set(mergedModels.map(m => m.id))
        : new Set(allowedModels);
    } else if (document.getElementById('editAccountAllModels').checked) {
      editSelectedModelIds = new Set(mergedModels.map(m => m.id));
    }

    const badgeClass = data.source === 'live' ? 'live' : 'fallback';
    const badgeLabel = data.source === 'live' ? 'Live API' : 'Fallback List';
    const countText = `${mergedModels.length} models`;
    const errNote = data.error ? ` <span class="muted">(${escapeHtml(data.error)})</span>` : '';
    sourceBadge.innerHTML = `<span class="source-badge ${badgeClass}">${badgeLabel}</span><span>${countText}</span>${errNote}`;

    toggleEditAccountAllModels();
    renderEditModelsList();

    if (forceRefresh) {
      showToast(`Loaded ${mergedModels.length} models (${badgeLabel})`, data.source === 'live' ? 'success' : 'error');
    }
  } catch (error) {
    console.error('Failed to fetch account models:', error);
    sourceBadge.innerHTML = `<span class="source-badge fallback">Error</span><span>${escapeHtml(error.message)}</span>`;
    listEl.innerHTML = '<p class="error">Failed to load models for this account</p>';
  } finally {
    refreshBtn.disabled = false;
    refreshBtn.textContent = '↻ Refresh Models';
  }
}

function renderEditModelsList() {
  const listEl = document.getElementById('editModelsList');
  const query = (document.getElementById('modelsSearchInput').value || '').trim().toLowerCase();

  const filtered = editingAccountModels.filter(m => {
    if (!query) return true;
    return (
      m.id.toLowerCase().includes(query) ||
      (m.displayName || '').toLowerCase().includes(query) ||
      (m.owned_by || '').toLowerCase().includes(query)
    );
  });

  if (filtered.length === 0) {
    listEl.innerHTML = '<p class="muted">No models match your filter.</p>';
    return;
  }

  listEl.innerHTML = filtered
    .map((m, idx) =>
      renderModelOptionHtml(
        m,
        `edit_model_${idx}`,
        editSelectedModelIds.has(m.id),
        `onEditModelCheckboxChange(this)`,
      ),
    )
    .join('');
}

function onEditModelCheckboxChange(checkbox) {
  if (checkbox.checked) {
    editSelectedModelIds.add(checkbox.value);
  } else {
    editSelectedModelIds.delete(checkbox.value);
  }
}

function addCustomModelId() {
  const input = document.getElementById('customModelInput');
  const modelId = input.value.trim();
  if (!modelId) return;

  // Switch off "Allow all models" so the user sees their custom selection active
  const allToggle = document.getElementById('editAccountAllModels');
  if (allToggle.checked) {
    allToggle.checked = false;
    toggleEditAccountAllModels();
  }

  const exists = editingAccountModels.some(m => m.id === modelId);
  if (!exists) {
    editingAccountModels.unshift({
      id: modelId,
      displayName: modelId,
      owned_by: 'custom',
      family: 'other',
    });
  }

  editSelectedModelIds.add(modelId);
  input.value = '';
  renderEditModelsList();
  showToast(`Added custom model: ${modelId}`, 'success');
}

function closeModelsModal() {
  editingAccountIndex = null;
  editingAccountModels = [];
  editSelectedModelIds = new Set();
  document.getElementById('modelsModal').style.display = 'none';
}

function toggleEditAccountAllModels() {
  const isAll = document.getElementById('editAccountAllModels').checked;
  const listEl = document.getElementById('editModelsList');
  const quickActions = document.getElementById('editModelsQuickActions');
  const customRow = document.getElementById('customModelRow');

  if (isAll) {
    listEl.classList.add('disabled');
    quickActions.classList.add('hidden');
    customRow.classList.add('hidden');
  } else {
    listEl.classList.remove('disabled');
    quickActions.classList.remove('hidden');
    customRow.classList.remove('hidden');
  }
}

function selectAllEditModels(selected) {
  if (selected) {
    editSelectedModelIds = new Set(editingAccountModels.map(m => m.id));
  } else {
    editSelectedModelIds.clear();
  }
  renderEditModelsList();
}

async function saveAccountModels() {
  if (editingAccountIndex === null) return;

  const saveBtn = document.getElementById('saveModelsBtn');
  const isAll = document.getElementById('editAccountAllModels').checked;
  const allowedModels = isAll ? null : Array.from(editSelectedModelIds);

  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving...';

  try {
    const response = await fetch(`/admin/api/accounts/${editingAccountIndex}/models`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ allowedModels }),
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Failed to save models');
    }

    closeModelsModal();
    await loadAccounts();
    showToast('Model selection saved', 'success');
  } catch (error) {
    console.error('Failed to save models:', error);
    showToast(error.message || 'Failed to save models', 'error');
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save Models';
  }
}

async function removeAccount(accountIndex) {
  const account = allAccounts.find(a => a.index === accountIndex);
  const label = account ? account.email : `Account #${accountIndex + 1}`;
  if (!confirm(`Are you sure you want to remove "${label}"?`)) {
    return;
  }

  try {
    const response = await fetch(`/admin/api/accounts/${accountIndex}`, {
      method: 'DELETE',
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Failed to remove account');
    }

    await Promise.all([loadAccounts(), loadHealth()]);
    showToast(`Removed account: ${label}`, 'success');
  } catch (error) {
    console.error('Failed to remove account:', error);
    showToast(error.message || 'Failed to remove account', 'error');
  }
}

// ============================================================================
// Metrics & Logs
// ============================================================================

async function loadMetrics() {
  try {
    const response = await fetch('/admin/api/metrics');
    const data = await response.json();

    const stats = data.stats;
    document.getElementById('avgDuration').textContent =
      stats.avgDuration ? stats.avgDuration + 'ms' : '-';

    const container = document.getElementById('metricsContainer');

    let html = '<div class="metrics-grid">';
    html += `<div class="metric-card"><div class="metric-label">Success</div><div class="metric-value success">${stats.successCount}</div></div>`;
    html += `<div class="metric-card"><div class="metric-label">Errors</div><div class="metric-value error">${stats.errorCount}</div></div>`;
    html += `<div class="metric-card"><div class="metric-label">Rate Limited</div><div class="metric-value warning">${stats.rateLimitedCount}</div></div>`;
    html += '</div>';

    if (stats.requestsByModel && Object.keys(stats.requestsByModel).length > 0) {
      html += '<h3>Requests by Model</h3>';
      html += '<table class="metrics-table"><thead><tr><th>Model</th><th>Requests</th></tr></thead><tbody>';

      for (const [model, count] of Object.entries(stats.requestsByModel)) {
        html += `<tr><td>${escapeHtml(model)}</td><td>${count}</td></tr>`;
      }

      html += '</tbody></table>';
    }

    container.innerHTML = html;
  } catch (error) {
    console.error('Failed to load metrics:', error);
    document.getElementById('metricsContainer').innerHTML =
      '<p class="error">Failed to load metrics</p>';
  }
}

async function loadLogs() {
  try {
    const response = await fetch('/admin/api/logs?limit=100');
    const data = await response.json();
    allLogs = data.logs || [];
    renderLogs(allLogs);
  } catch (error) {
    console.error('Failed to load logs:', error);
    document.getElementById('logsContainer').innerHTML =
      '<p class="error">Failed to load logs</p>';
  }
}

function renderLogs(logs) {
  const container = document.getElementById('logsContainer');
  const filter = document.getElementById('logsFilter').value.toLowerCase();

  const filteredLogs = logs.filter(log => {
    if (!filter) return true;
    return (
      log.model.toLowerCase().includes(filter) ||
      log.status.toLowerCase().includes(filter) ||
      log.type.toLowerCase().includes(filter)
    );
  });

  if (filteredLogs.length === 0) {
    container.innerHTML = '<p class="info">No matching requests found</p>';
    return;
  }

  let html = '<table class="logs-table"><thead><tr>';
  html += '<th>Time</th>';
  html += '<th>Model</th>';
  html += '<th>Type</th>';
  html += '<th>Duration</th>';
  html += '<th>Status</th>';
  html += '<th>Tokens</th>';
  html += '<th>Details</th>';
  html += '</tr></thead><tbody>';

  for (const log of filteredLogs) {
    html += `<tr onclick="openDetails('${log.id}')">`;
    html += `<td>${formatTimestamp(log.timestamp)}</td>`;
    html += `<td>${escapeHtml(log.model)}</td>`;
    html += `<td>${log.type}</td>`;
    html += `<td>${log.duration}ms</td>`;
    html += `<td><span class="status-badge ${log.status}">${log.status}</span></td>`;
    html += `<td>${log.tokens || '-'}</td>`;
    html += `<td><button class="btn btn-sm">View</button></td>`;
    html += '</tr>';
  }

  html += '</tbody></table>';
  container.innerHTML = html;
}

function openDetails(logId) {
  const log = allLogs.find(l => l.id === logId);
  if (!log) return;

  const modal = document.getElementById('detailsModal');
  const requestEl = document.getElementById('modalRequest');
  const responseEl = document.getElementById('modalResponse');

  requestEl.textContent = log.request ? JSON.stringify(log.request, null, 2) : '(no data)';

  if (typeof log.response === 'string') {
    responseEl.textContent = log.response; // For accumulated stream strings
  } else {
    responseEl.textContent = log.response ? JSON.stringify(log.response, null, 2) : '(no data)';
  }

  modal.style.display = 'block';
}

function closeModal() {
  document.getElementById('detailsModal').style.display = 'none';
}

// Close modals when clicking outside
window.onclick = function(event) {
  const detailsModal = document.getElementById('detailsModal');
  const addModal = document.getElementById('addAccountModal');
  const modelsModal = document.getElementById('modelsModal');

  if (event.target === detailsModal) {
    closeModal();
  } else if (event.target === addModal) {
    closeAddAccountModal();
  } else if (event.target === modelsModal) {
    closeModelsModal();
  }
};

document.getElementById('logsFilter').addEventListener('input', () => {
  renderLogs(allLogs);
});

async function refreshLogs() {
  await loadLogs();
}

async function clearLogs() {
  if (!confirm('Are you sure you want to clear all logs?')) {
    return;
  }

  try {
    await fetch('/admin/api/logs/clear', { method: 'POST' });
    await loadLogs();
  } catch (error) {
    console.error('Failed to clear logs:', error);
    alert('Failed to clear logs');
  }
}

function showToast(message, type = 'success') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = `toast ${type}`;

  if (toastTimer) {
    clearTimeout(toastTimer);
  }
  toastTimer = setTimeout(() => {
    toast.classList.add('hidden');
  }, 3500);
}

function formatUptime(seconds) {
  if (!seconds) return '-';

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${hours}h ${minutes}m ${secs}s`;
  } else if (minutes > 0) {
    return `${minutes}m ${secs}s`;
  } else {
    return `${secs}s`;
  }
}

function formatTimestamp(timestamp) {
  if (!timestamp) return '-';

  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();

  // Handle future dates (e.g. rate limit resets)
  if (diffMs < 0) {
    const absDiffMs = Math.abs(diffMs);
    const diffSecs = Math.floor(absDiffMs / 1000);
    const diffMins = Math.floor(absDiffMs / 60000);

    if (diffSecs < 60) {
      return `in ${diffSecs}s`;
    } else if (diffMins < 60) {
      return `in ${diffMins}m ${Math.floor((absDiffMs % 60000) / 1000)}s`;
    } else {
      return `in ${Math.floor(diffMins / 60)}h ${diffMins % 60}m`;
    }
  }

  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) {
    return 'Just now';
  } else if (diffMins < 60) {
    return `${diffMins}m ago`;
  } else if (diffMins < 1440) {
    return `${Math.floor(diffMins / 60)}h ago`;
  } else {
    return date.toLocaleString();
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = String(text ?? '');
  return div.innerHTML;
}

// Auto-refresh every 5 seconds
refreshInterval = setInterval(loadDashboard, 5000);

// Initial load
loadDashboard();
