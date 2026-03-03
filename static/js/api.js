/**
 * ComfyUI API Client
 * Handles all communication with ComfyUI API Server V2
 */

// Dynamically determine API server URL based on current browser location
function getDefaultAPIURL() {
    const hostname = window.location.hostname || 'localhost';
    const port = String(window.location.port || '').trim();
    // If the webapp is accessed via a reverse proxy (non-8080), assume API is reachable via the same origin.
    // Standalone local dev convention: webapp/API on :8090.
    if (port && port !== '8080') {
        return window.location.origin;
    }
    return `http://${hostname}:8090`;
}

// Stable client session id (Phase2 groundwork for distributed/pinning)
function getClientSessionId() {
    try {
        const key = 'comfyui_api_client_session_id';
        let id = localStorage.getItem(key);
        if (!id) {
            id = (crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`);
            localStorage.setItem(key, id);
        }
        return id;
    } catch (e) {
        // Fallback if localStorage is blocked
        return `tmp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    }
}

// Temporary per-tab session id (used when USER_ID is not set)
function getTemporaryClientSessionId() {
    try {
        const key = 'comfyui_api_temporary_client_session_id';
        let id = sessionStorage.getItem(key);
        if (!id) {
            id = (crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`);
            sessionStorage.setItem(key, id);
        }
        return id;
    } catch (e) {
        // Fallback if sessionStorage is blocked
        return `tmp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    }
}

function setSessionCookie(sessionId) {
    try {
        const id = String(sessionId || '').trim();
        if (!id) return;
        // Session cookie (no Max-Age) so it expires when the browser session ends.
        // This is intentionally NOT a secret; it is used for server-side access control.
        document.cookie = `comfyui_client_session_id=${encodeURIComponent(id)}; Path=/; SameSite=Lax`;
    } catch (e) {
        // ignore
    }
}

// Optional USER_ID (no password; minimal management)
function getUserId() {
    try {
        const key = 'comfyui_api_user_id';
        const raw = localStorage.getItem(key);
        const id = (raw || '').trim();
        return id || null;
    } catch (e) {
        return null;
    }
}

// Local registry of known USER_IDs (browser-local; used for switching UX)
function _normalizeUserId(userId) {
    const id = String(userId || '').trim();
    return id || null;
}

function getKnownUserIds() {
    try {
        const key = 'comfyui_api_known_user_ids';
        const raw = localStorage.getItem(key);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed
            .map((v) => (typeof v === 'string' ? v.trim() : ''))
            .filter((v) => !!v);
    } catch (e) {
        return [];
    }
}

function isRegisteredUserId(userId) {
    const id = _normalizeUserId(userId);
    if (!id) return false;
    const known = getKnownUserIds();
    return known.includes(id);
}

function registerUserId(userId) {
    try {
        const id = _normalizeUserId(userId);
        if (!id) return false;
        const key = 'comfyui_api_known_user_ids';
        const known = getKnownUserIds();
        if (!known.includes(id)) known.unshift(id);
        // Keep the list bounded
        const bounded = known.slice(0, 50);
        localStorage.setItem(key, JSON.stringify(bounded));
        return true;
    } catch (e) {
        return false;
    }
}

function setUserId(userId) {
    try {
        const key = 'comfyui_api_user_id';
        const id = String(userId || '').trim();
        if (!id) {
            localStorage.removeItem(key);
            setSessionCookie(getTemporaryClientSessionId());
            return;
        }
        // Treat any explicitly set USER_ID as "registered" in this browser.
        try {
            registerUserId(id);
        } catch (e) {
            // ignore
        }
        localStorage.setItem(key, id);
        setSessionCookie(id);
    } catch (e) {
        // ignore
    }
}

function createNewUserId() {
    // Human-friendly enough, no secrets.
    const suffix = (crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`)
        .replace(/[^a-zA-Z0-9]/g, '')
        .slice(0, 10)
        .toLowerCase();
    return `user-${suffix}`;
}

function getEffectiveClientSessionId() {
    // If USER_ID is not set, isolate this browser tab using a temporary session id.
    // If USER_ID is set, treat it as the effective session id.
    const sid = getUserId() || getTemporaryClientSessionId();
    setSessionCookie(sid);
    return sid;
}

function getEffectiveSessionMode() {
    // If USER_ID is set, we treat this as a named user session.
    // Otherwise this is a per-tab temporary session.
    return getUserId() ? 'user' : 'temporary';
}

// Export minimal USER_ID helpers for UI code
window.UserId = {
    getUserId,
    setUserId,
    createNewUserId,
    getEffectiveClientSessionId,
    getEffectiveSessionMode,
    getKnownUserIds,
    registerUserId,
    isRegisteredUserId,
};

// Ensure an already-set USER_ID is considered registered in this browser.
try {
    const existing = getUserId();
    if (existing) registerUserId(existing);
} catch (e) {
    // ignore
}

class ComfyUIAPI {
    constructor(baseURL = getDefaultAPIURL()) {
        this.baseURL = baseURL;
        this.wsConnections = new Map(); // job_id -> WebSocket
        // WebSocket through reverse proxies is unreliable (especially Firefox).
        // Only enable WebSocket when accessing via localhost directly.
        const h = window.location.hostname;
        const isLocal = (h === 'localhost' || h === '127.0.0.1' || h === '::1');
        this._wsAvailable = isLocal;
        if (!isLocal) {
            console.log('[ComfyUIAPI] Proxy access detected — using HTTP polling instead of WebSocket');
        }
    }

    /**
     * Generate content (POST /api/v1/generate)
     * @param {Object} params - Generation parameters
     * @returns {Promise<Object>} Job response
     */
    async generate(params) {
        try {
            const response = await fetch(`${this.baseURL}/api/v1/generate`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    response_type: 'url', // Always use URL mode for progress tracking
                    client_session_id: getEffectiveClientSessionId(),
                    session_mode: getEffectiveSessionMode(),
                    ...params
                })
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            return await response.json();
        } catch (error) {
            console.error('Generation failed:', error);
            throw error;
        }
    }

    /**
     * Generate utility content (POST /api/v1/utility)
     * For video concat and other utility operations
     * @param {Object} params - Utility parameters
     * @returns {Promise<Object>} Job response
     */
    async generateUtility(params) {
        try {
            const response = await fetch(`${this.baseURL}/api/v1/utility`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    client_session_id: getEffectiveClientSessionId(),
                    session_mode: getEffectiveSessionMode(),
                    ...params
                })
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            return await response.json();
        } catch (error) {
            console.error('Utility operation failed:', error);
            throw error;
        }
    }

    /**
     * Translate text (POST /api/v1/translate)
     * @param {string} text - Text to translate
     * @param {string} targetLanguage - Target language ('ja', 'en', or 'auto')
     * @returns {Promise<Object>} Translation response
     */
    async translate(text, targetLanguage = 'en') {
        try {
            const response = await fetch(`${this.baseURL}/api/v1/translate`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    text: text,
                    target_language: targetLanguage
                })
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            return await response.json();
        } catch (error) {
            console.error('Translation failed:', error);
            throw error;
        }
    }

    /**
     * Get job status (GET /api/v1/status/{job_id})
     * @param {string} jobId - Job ID
     * @returns {Promise<Object>} Job status
     */
    async getJobStatus(jobId) {
        try {
            const response = await fetch(`${this.baseURL}/api/v1/status/${jobId}`);
            
            if (response.status === 404) {
                // Job not found — likely server restarted
                return { status: 'failed', error: 'Job not found (server may have restarted)' };
            }

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            return await response.json();
        } catch (error) {
            console.error('Failed to get job status:', error);
            throw error;
        }
    }

    /**
     * Cancel a queued job (DELETE /api/v1/jobs/{job_id})
     * Note: server only supports cancelling QUEUED jobs. PROCESSING jobs may return 400.
     */
    async cancelJob(jobId) {
        try {
            const response = await fetch(`${this.baseURL}/api/v1/jobs/${encodeURIComponent(String(jobId))}`, {
                method: 'DELETE',
            });

            // Best-effort: try to parse body for message/detail.
            const text = await response.text();
            let data = null;
            try {
                data = text ? JSON.parse(text) : null;
            } catch (_e) {
                data = text ? { detail: text } : null;
            }

            if (!response.ok) {
                const msg = (data && (data.detail || data.message))
                    ? String(data.detail || data.message)
                    : `HTTP ${response.status}: ${response.statusText}`;
                const err = new Error(msg);
                err.status = response.status;
                err.data = data;
                throw err;
            }

            return data || { message: 'Job cancelled', job_id: String(jobId) };
        } catch (error) {
            console.error('Failed to cancel job:', error);
            throw error;
        }
    }

    /**
     * Force stop a job by interrupting the underlying ComfyUI prompt.
     * (POST /api/v1/jobs/{job_id}/interrupt)
     */
    async interruptJob(jobId) {
        try {
            const response = await fetch(`${this.baseURL}/api/v1/jobs/${encodeURIComponent(String(jobId))}/interrupt`, {
                method: 'POST',
            });

            const text = await response.text();
            let data = null;
            try {
                data = text ? JSON.parse(text) : null;
            } catch (_e) {
                data = text ? { detail: text } : null;
            }

            if (!response.ok) {
                const msg = (data && (data.detail || data.message))
                    ? String(data.detail || data.message)
                    : `HTTP ${response.status}: ${response.statusText}`;
                const err = new Error(msg);
                err.status = response.status;
                err.data = data;
                throw err;
            }

            return data || { message: 'Interrupt requested', job_id: String(jobId) };
        } catch (error) {
            console.error('Failed to interrupt job:', error);
            throw error;
        }
    }

    /**
     * Force stop currently processing job(s) on server side.
     * Useful fallback when a specific jobId is not available on frontend.
     * (POST /api/v1/interrupt)
     */
    async interruptActiveJob() {
        try {
            const response = await fetch(`${this.baseURL}/api/v1/interrupt`, {
                method: 'POST',
            });

            const text = await response.text();
            let data = null;
            try {
                data = text ? JSON.parse(text) : null;
            } catch (_e) {
                data = text ? { detail: text } : null;
            }

            if (!response.ok) {
                const msg = (data && (data.detail || data.message))
                    ? String(data.detail || data.message)
                    : `HTTP ${response.status}: ${response.statusText}`;
                const err = new Error(msg);
                err.status = response.status;
                err.data = data;
                throw err;
            }

            return data || { message: 'Interrupt requested' };
        } catch (error) {
            console.error('Failed to interrupt active job:', error);
            throw error;
        }
    }

    /**
     * Monitor job progress via HTTP polling (fallback when WebSocket is unavailable)
     * @param {string} jobId - Job ID
     * @param {Function} onProgress - Callback(progressData)
     * @param {Function} onComplete - Callback(result)
     * @param {Function} onError - Callback(error)
     * @param {number} intervalMs - Polling interval in ms (default 1500)
     */
    monitorProgressPolling(jobId, onProgress, onComplete, onError, intervalMs = 1500) {
        let stopped = false;
        let retryCount = 0;
        const maxRetries = 10;
        console.log(`[Polling] Starting HTTP polling for job ${jobId}`);
        const poll = async () => {
            if (stopped) return;
            try {
                const data = await this.getJobStatus(jobId);
                if (stopped) return;
                retryCount = 0; // reset on success
                console.log(`[Polling] job ${jobId} status=${data?.status} progress=${data?.progress}`);

                if (data && data.error && !data.status) {
                    stopped = true;
                    console.log(`[Polling] job ${jobId} error (no status):`, data.error);
                    if (onError) onError(new Error(String(data.error)));
                    return;
                }

                // Job not found (404) — server may have restarted
                if (data && data.detail && !data.status) {
                    stopped = true;
                    console.log(`[Polling] job ${jobId} not found:`, data.detail);
                    if (onError) onError(new Error(String(data.detail)));
                    return;
                }

                if ((data.status === 'queued' || data.status === 'processing') && onProgress) {
                    onProgress({
                        progress: data.progress || 0,
                        message: data.message || 'Processing...',
                        job_id: data.job_id
                    });
                }

                if (data.status === 'completed') {
                    stopped = true;
                    console.log(`[Polling] job ${jobId} completed, calling onComplete`);
                    if (onComplete) onComplete(data);
                    return;
                }

                if (data.status === 'cancelled') {
                    stopped = true;
                    if (onError) onError(new Error('Job cancelled'));
                    return;
                }

                if (data.status === 'failed') {
                    stopped = true;
                    const msg = data.error || data.message || 'Job failed';
                    if (onError) onError(new Error(String(msg)));
                    return;
                }

                // Continue polling
                setTimeout(poll, intervalMs);
            } catch (err) {
                if (stopped) return;
                retryCount++;
                if (retryCount >= maxRetries) {
                    console.error(`Polling failed after ${maxRetries} retries:`, err);
                    stopped = true;
                    if (onError) onError(err instanceof Error ? err : new Error(String(err)));
                    return;
                }
                // Silently retry on transient network errors
                console.warn(`[Polling] retry ${retryCount}/${maxRetries} for job ${jobId}`);
                setTimeout(poll, intervalMs * 2);
            }
        };
        // Start first poll after a short delay
        setTimeout(poll, 500);
        // Return a handle to allow cancellation
        return { stop: () => { stopped = true; } };
    }

    /**
     * Monitor job progress via WebSocket, with automatic HTTP polling fallback
     * @param {string} jobId - Job ID
     * @param {Function} onProgress - Callback(progressData)
     * @param {Function} onComplete - Callback(result)
     * @param {Function} onError - Callback(error)
     * @returns {WebSocket} WebSocket instance
     */
    monitorProgress(jobId, onProgress, onComplete, onError) {
        // If WebSocket is known to be unavailable, go straight to HTTP polling
        if (!this._wsAvailable) {
            console.log(`[monitorProgress] Using HTTP polling for job ${jobId} (WebSocket unavailable)`);
            this.monitorProgressPolling(jobId, onProgress, onComplete, onError);
            return null;
        }

        const wsURL = `ws://${this.baseURL.replace('http://', '').replace('https://', '')}/ws/jobs/${jobId}`;
        let wsOpened = false;
        let settled = false; // true once onComplete or onError has been called

        const ws = new WebSocket(wsURL);

        ws.onopen = () => {
            wsOpened = true;
            console.log(`WebSocket connected for job ${jobId}`);
        };

        ws.onmessage = (event) => {
            if (settled) return;
            try {
                const data = JSON.parse(event.data);
                console.log('WebSocket message:', data);

                // Server-side error payloads (e.g. {error: "Job not found"})
                if (data && data.error) {
                    console.error('WebSocket server error:', data.error);
                    settled = true;
                    if (onError) onError(new Error(String(data.error)));
                    ws.close();
                    return;
                }
                
                // Progress update
                if ((data.status === 'queued' || data.status === 'processing') && onProgress) {
                    onProgress({
                        progress: data.progress || 0,
                        message: data.message || 'Processing...',
                        job_id: data.job_id
                    });
                }
                
                // Job completed
                if (data.status === 'completed' && onComplete) {
                    console.log('Job completed, calling onComplete with:', data);
                    settled = true;
                    onComplete(data);
                    ws.close();
                }

                // Job cancelled
                if (data.status === 'cancelled') {
                    settled = true;
                    if (onError) onError(new Error('Job cancelled'));
                    ws.close();
                }
                
                // Job failed
                if (data.status === 'failed') {
                    settled = true;
                    const primaryMsg = data.error || data.message || data.detail;
                    console.error('Job failed:', primaryMsg || data);
                    if (primaryMsg) {
                        if (onError) onError(new Error(String(primaryMsg)));
                        ws.close();
                        return;
                    }

                    // Fallback: fetch status to get a better error string.
                    this.getJobStatus(jobId)
                        .then((st) => {
                            const msg = (st && (st.error || st.message)) ? String(st.error || st.message) : 'Job failed';
                            if (onError) onError(new Error(msg));
                        })
                        .catch(() => {
                            if (onError) onError(new Error('Job failed'));
                        })
                        .finally(() => {
                            ws.close();
                        });
                }
            } catch (err) {
                console.error('WebSocket message parsing error:', err, event.data);
            }
        };

        ws.onerror = (error) => {
            console.error('WebSocket error:', error);
            if (settled) return;
            // If WebSocket never opened, fall back to HTTP polling
            if (!wsOpened) {
                this._wsAvailable = false; // Remember: don't try WebSocket again
                console.warn(`WebSocket failed for job ${jobId}; falling back to HTTP polling (will use polling for future jobs)`);
                settled = true;
                this.monitorProgressPolling(jobId, onProgress, onComplete, onError);
            } else {
                settled = true;
                if (onError) onError(error instanceof Error ? error : new Error('WebSocket error'));
            }
        };

        ws.onclose = () => {
            console.log(`WebSocket closed for job ${jobId}`);
            this.wsConnections.delete(jobId);
        };

        this.wsConnections.set(jobId, ws);
        return ws;
    }

    /**
     * Get download URL for output file
     * @param {string} jobId - Job ID
     * @param {string} filename - Filename
     * @returns {string} Download URL
     */
    getDownloadURL(jobId, filename) {
        const sessionId = (typeof getEffectiveClientSessionId === 'function')
            ? getEffectiveClientSessionId()
            : (typeof getClientSessionId === 'function' ? getClientSessionId() : null);

        // Encode each path segment but preserve slashes for subfolders.
        const safeFilename = String(filename || '')
            .split('/')
            .map((seg) => encodeURIComponent(seg))
            .join('/');

        const base = `${this.baseURL}/api/v1/download/${encodeURIComponent(String(jobId))}/${safeFilename}`;
        if (!sessionId) return base;
        return `${base}?client_session_id=${encodeURIComponent(String(sessionId))}`;
    }

    /**
     * Get outputs list for a job
     * @param {string} jobId - Job ID
     * @returns {Promise<Object>} Outputs list
     */
    async getOutputs(jobId) {
        try {
            const controller = new AbortController();
            const timeoutMs = 15000;
            const timer = setTimeout(() => {
                try { controller.abort(); } catch (_e) {}
            }, timeoutMs);

            const response = await fetch(`${this.baseURL}/api/v1/outputs/${jobId}`, {
                signal: controller.signal,
            });
            clearTimeout(timer);
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            return await response.json();
        } catch (error) {
            console.error('Failed to get outputs:', error);
            throw error;
        }
    }

    /**
     * Get queue status
     * @returns {Promise<Object>} Queue status
     */
    async getQueueStatus() {
        try {
            const response = await fetch(`${this.baseURL}/api/v1/queue`);
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            return await response.json();
        } catch (error) {
            console.error('Failed to get queue status:', error);
            throw error;
        }
    }

    /**
     * Get available workflows
     * @returns {Promise<Object>} Workflows list
     */
    async getWorkflows() {
        try {
            const response = await fetch(`${this.baseURL}/api/v1/workflows`);
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            return await response.json();
        } catch (error) {
            console.error('Failed to get workflows:', error);
            throw error;
        }
    }

    /**
     * List registered ref images for this session (GET /api/v1/ref-images)
     * @returns {Promise<{success: boolean, items: Array}>}
     */
    async listRefImages() {
        const sessionId = (typeof getEffectiveClientSessionId === 'function')
            ? getEffectiveClientSessionId()
            : (typeof getClientSessionId === 'function' ? getClientSessionId() : null);

        if (!sessionId) {
            throw new Error('client_session_id is not available');
        }

        const url = `${this.baseURL}/api/v1/ref-images?client_session_id=${encodeURIComponent(sessionId)}&session_mode=${encodeURIComponent(getEffectiveSessionMode())}`;
        const response = await fetch(url);
        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.detail || `HTTP ${response.status}: ${response.statusText}`);
        }
        return await response.json();
    }

    /**
     * Load persisted Simple Video state for this session (GET /api/v1/simple-video/state)
     */
    async getSimpleVideoState() {
        const sessionId = (typeof getEffectiveClientSessionId === 'function')
            ? getEffectiveClientSessionId()
            : (typeof getClientSessionId === 'function' ? getClientSessionId() : null);

        if (!sessionId) {
            throw new Error('client_session_id is not available');
        }

        const url = `${this.baseURL}/api/v1/simple-video/state?client_session_id=${encodeURIComponent(sessionId)}&session_mode=${encodeURIComponent(getEffectiveSessionMode())}`;
        const response = await fetch(url);
        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.detail || `HTTP ${response.status}: ${response.statusText}`);
        }
        return await response.json();
    }

    /**
     * Persist Simple Video state for this session (POST /api/v1/simple-video/state)
     */
    async saveSimpleVideoState(state) {
        const sessionId = (typeof getEffectiveClientSessionId === 'function')
            ? getEffectiveClientSessionId()
            : (typeof getClientSessionId === 'function' ? getClientSessionId() : null);

        if (!sessionId) {
            throw new Error('client_session_id is not available');
        }

        const response = await fetch(`${this.baseURL}/api/v1/simple-video/state`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                client_session_id: sessionId,
                session_mode: getEffectiveSessionMode(),
                state: (state && typeof state === 'object') ? state : {},
            }),
        });

        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.detail || `HTTP ${response.status}: ${response.statusText}`);
        }

        return await response.json();
    }

    /**
     * Register/update a ref image name mapping (POST /api/v1/ref-images)
     * - Use `file` OR `filename` (pre-uploaded via /api/v1/upload)
     */
    async registerRefImage({ name, file = null, filename = null, original_filename = null }) {
        const sessionId = (typeof getEffectiveClientSessionId === 'function')
            ? getEffectiveClientSessionId()
            : (typeof getClientSessionId === 'function' ? getClientSessionId() : null);

        if (!sessionId) {
            throw new Error('client_session_id is not available');
        }
        if (!name) {
            throw new Error('name is required');
        }

        const form = new FormData();
        form.append('name', String(name));
        form.append('client_session_id', sessionId);
        form.append('session_mode', getEffectiveSessionMode());

        if (file instanceof File) {
            form.append('file', file);
        } else if (filename) {
            form.append('filename', String(filename));
            if (original_filename) {
                form.append('original_filename', String(original_filename));
            }
        } else {
            throw new Error('Either file or filename is required');
        }

        const response = await fetch(`${this.baseURL}/api/v1/ref-images`, {
            method: 'POST',
            body: form,
        });
        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.detail || `HTTP ${response.status}: ${response.statusText}`);
        }
        return await response.json();
    }

    /**
     * Delete (soft-delete) a ref image mapping (DELETE /api/v1/ref-images/{name})
     */
    async deleteRefImage(name) {
        const sessionId = (typeof getEffectiveClientSessionId === 'function')
            ? getEffectiveClientSessionId()
            : (typeof getClientSessionId === 'function' ? getClientSessionId() : null);

        if (!sessionId) {
            throw new Error('client_session_id is not available');
        }
        if (!name) {
            throw new Error('name is required');
        }

        const url = `${this.baseURL}/api/v1/ref-images/${encodeURIComponent(String(name))}?client_session_id=${encodeURIComponent(sessionId)}&session_mode=${encodeURIComponent(getEffectiveSessionMode())}`;
        const response = await fetch(url, { method: 'DELETE' });
        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.detail || `HTTP ${response.status}: ${response.statusText}`);
        }
        return await response.json();
    }

    /**
     * Build an absolute preview URL from an item.preview_url (relative)
     */
    getRefImagePreviewURL(previewUrlPath) {
        if (!previewUrlPath) return null;
        if (/^https?:\/\//i.test(previewUrlPath)) return previewUrlPath;
        return `${this.baseURL}${previewUrlPath}`;
    }

    /**
     * Close WebSocket connection
     * @param {string} jobId - Job ID
     */
    closeWebSocket(jobId) {
        const ws = this.wsConnections.get(jobId);
        if (ws) {
            ws.close();
            this.wsConnections.delete(jobId);
        }
    }

    /**
     * Close all WebSocket connections
     */
    closeAllWebSockets() {
        this.wsConnections.forEach(ws => ws.close());
        this.wsConnections.clear();
    }
}

// Export for use in other modules
window.ComfyUIAPI = ComfyUIAPI;
