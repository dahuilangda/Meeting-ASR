import axios from 'axios';

const API_SERVER_URL = process.env.REACT_APP_API_URL || "http://localhost:8000";

// Retry configuration
const MAX_RETRIES = 3;
const RETRY_DELAY_BASE = 1000; // 1 second base delay
const RETRY_STATUS_CODES = [408, 429, 500, 502, 503, 504];

// Type for request metadata
interface RequestMetadata {
    startTime: Date;
    retryCount?: number;
}

// Retry helper function
const shouldRetry = (error: any): boolean => {
    if (!error.config) return false;

    const retryCount = (error.config.metadata as RequestMetadata)?.retryCount || 0;
    if (retryCount >= MAX_RETRIES) return false;

    // Retry on network errors or specific status codes
    if (!error.response) return true; // Network error
    return RETRY_STATUS_CODES.includes(error.response.status);
};

// Retry delay with exponential backoff
const getRetryDelay = (retryCount: number): number => {
    return RETRY_DELAY_BASE * Math.pow(2, retryCount);
};

// Create a more resilient axios instance
export const apiClient = axios.create({
    baseURL: API_SERVER_URL,
    timeout: 30000, // 30 seconds timeout
});

// Request interceptor for authentication and logging
apiClient.interceptors.request.use(config => {
    const token = localStorage.getItem('token');
    if (token) {
        // Ensure headers exist before setting Authorization
        if (!config.headers) {
            config.headers = {};
        }
        // Properly handle the headers assignment using the config properties
        Object.assign(config.headers, {
            ...config.headers,
            Authorization: `Bearer ${token}`
        });
    }

    // Add request timestamp for debugging
    (config as any).metadata = { startTime: new Date() };

    return config;
}, (error) => {
    return Promise.reject(error);
});

// Enhanced response interceptor with retry logic and better error handling
apiClient.interceptors.response.use(
    response => response,
    async error => {
        const originalRequest = error.config;

        // Check if the error is due to unauthorized access (token expired or invalid)
        if (error.response && error.response.status === 401) {
            // Remove the invalid token
            localStorage.removeItem('token');
            // Redirect to login page
            window.location.href = '/login';
            return Promise.reject(error);
        }

        // Implement retry logic
        if (shouldRetry(error)) {
            const metadata = (originalRequest as any).metadata as RequestMetadata;
            const retryCount = metadata?.retryCount || 0;

            // Set retry count
            (originalRequest as any).metadata = {
                ...metadata,
                retryCount: retryCount + 1
            };

            const delay = getRetryDelay(retryCount);

            // Wait for the delay
            await new Promise(resolve => setTimeout(resolve, delay));

            // Retry the request
            return apiClient(originalRequest);
        }

        return Promise.reject(error);
    }
);

export type ChatRole = 'user' | 'assistant' | 'system';

export interface ChatMessagePayload {
    role: ChatRole;
    content: string;
}

// Enhanced fetch with retry for streaming
const fetchWithRetry = async (
    url: string,
    options: RequestInit,
    maxRetries: number = 3,
    retryDelay: number = 1000
): Promise<Response> => {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            const response = await fetch(url, {
                ...options,
                signal: AbortSignal.timeout(30000) // 30 second timeout per attempt
            });

            // Don't retry on client errors (4xx) except for specific retryable status codes
            if (response.ok || (response.status >= 400 && response.status < 500 && ![408, 429].includes(response.status))) {
                return response;
            }

            // For retryable errors, continue to next attempt
            const errorText = await response.text();
            lastError = new Error(`HTTP error! status: ${response.status}, detail: ${errorText}`);

        } catch (error) {
            lastError = error instanceof Error ? error : new Error('Unknown fetch error');

            // If this is the last attempt, throw the error
            if (attempt === maxRetries) {
                break;
            }
        }

        // If not the last attempt, wait before retrying
        if (attempt < maxRetries) {
            const delay = retryDelay * Math.pow(2, attempt); // Exponential backoff
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }

    throw lastError || new Error('All fetch attempts failed');
};

// 流式聊天接口
export const sendAssistantChatStream = async (
    messages: ChatMessagePayload[],
    systemPrompt?: string,
    onChunk?: (chunk: string) => void,
    onComplete?: () => void,
    onError?: (error: string) => void
): Promise<string> => {
    try {
        const token = localStorage.getItem('token');

        const requestData = {
            messages,
            systemPrompt,
        };

        const response = await fetchWithRetry(`${API_SERVER_URL}/assistant/chat/stream`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
                'Accept': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
            },
            body: JSON.stringify(requestData),
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`HTTP error! status: ${response.status}, detail: ${errorText}`);
        }

        const reader = response.body?.getReader();
        const decoder = new TextDecoder();

        if (!reader) {
            throw new Error('No response body');
        }

        let accumulatedContent = '';
        let buffer = '';
        let streamActive = true;
        let streamCompleted = false;
        let streamFailed = false;

        const processBuffer = () => {
            while (streamActive) {
                const eventBoundary = buffer.indexOf('\n\n');
                if (eventBoundary === -1) {
                    break;
                }

                const eventBlock = buffer.slice(0, eventBoundary);
                buffer = buffer.slice(eventBoundary + 2);

                const lines = eventBlock.split('\n');
                for (const rawLine of lines) {
                    const line = rawLine.trim();
                    if (!line.startsWith('data:')) {
                        continue;
                    }

                    const payload = line.slice(5).trimStart();
                    if (!payload) {
                        continue;
                    }

                    try {
                        const data = JSON.parse(payload);

                        if (data.error) {
                            streamFailed = true;
                            streamActive = false;
                            onError?.(data.error);
                            return;
                        }

                        if (data.content) {
                            accumulatedContent += data.content;
                            onChunk?.(data.content);
                        }

                        if (data.done) {
                            streamCompleted = true;
                            streamActive = false;
                            onComplete?.();
                            return;
                        }
                    } catch {
                        // Ignore malformed SSE data but keep stream active
                    }
                }
            }
        };

        while (streamActive) {
            const { done, value } = await reader.read();

            if (done) {
                buffer += decoder.decode();
                processBuffer();
                break;
            }

            buffer += decoder.decode(value, { stream: true });
            processBuffer();
        }

        if (streamActive) {
            // Stream ended unexpectedly without explicit done/error marker
            const remaining = buffer.trim();
            if (remaining) {
                try {
                    const data = JSON.parse(remaining.replace(/^data:\s*/, ''));
                    if (data.content) {
                        accumulatedContent += data.content;
                        onChunk?.(data.content);
                    }
                } catch {
                    // Ignore residual parsing issues
                }
            }
            streamActive = false;
        }

        try {
            await reader.cancel();
        } catch {
            // Ignore cancellation errors
        }

        if (!streamCompleted && !streamFailed) {
            onComplete?.();
        }

        return accumulatedContent;
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        onError?.(errorMessage);
        throw error;
    }
};

// 摘要生成接口（非流式）
export const generateSummary = async (jobId: number, language: string = "Chinese") => {
    const response = await apiClient.post(`/jobs/${jobId}/summarize`, {
        target_language: language
    });
    return response.data;
};

export interface JobRenameResponse {
    id: number;
    filename: string;
    status: string;
    created_at: string;
    summary?: string | null;
    transcript?: string | null;
}

export const renameJob = async (jobId: number, filename: string): Promise<JobRenameResponse> => {
    const response = await apiClient.put<JobRenameResponse>(`/jobs/${jobId}/rename`, { filename });
    return response.data;
};

// Network error monitoring utilities
export const NetworkErrorHandler = {
    // Check if online
    isOnline: (): boolean => navigator.onLine,

    // Monitor network status changes
    onStatusChange: (callback: (isOnline: boolean) => void) => {
        window.addEventListener('online', () => callback(true));
        window.addEventListener('offline', () => callback(false));

        // Return cleanup function
        return () => {
            window.removeEventListener('online', () => callback(true));
            window.removeEventListener('offline', () => callback(false));
        };
    },

    // Get detailed error information
    getErrorDetails: (error: any): {
        message: string;
        isNetworkError: boolean;
        isTimeout: boolean;
        isServerError: boolean;
        isClientError: boolean;
        statusCode?: number;
    } => {
        if (!error) {
            return {
                message: 'Unknown error occurred',
                isNetworkError: false,
                isTimeout: false,
                isServerError: false,
                isClientError: false
            };
        }

        const errorMessage = error.message || error.toString();
        const isNetworkError = !error.response && (
            errorMessage.includes('Network Error') ||
            errorMessage.includes('Failed to fetch') ||
            errorMessage.includes('ERR_NETWORK')
        );
        const isTimeout = errorMessage.includes('timeout') || error.code === 'ECONNABORTED';
        const statusCode = error.response?.status;
        const isServerError = statusCode && statusCode >= 500;
        const isClientError = statusCode && statusCode >= 400 && statusCode < 500;

        return {
            message: errorMessage,
            isNetworkError,
            isTimeout,
            isServerError,
            isClientError,
            statusCode
        };
    },

    // Format error for user display
    formatError: (error: any): string => {
        const details = NetworkErrorHandler.getErrorDetails(error);

        if (details.isNetworkError) {
            return '网络连接错误，请检查您的网络连接后重试';
        }

        if (details.isTimeout) {
            return '请求超时，请稍后重试';
        }

        if (details.isServerError) {
            return '服务器暂时无法响应，请稍后重试';
        }

        if (details.statusCode === 401) {
            return '登录已过期，请重新登录';
        }

        if (details.statusCode === 403) {
            return '没有权限执行此操作';
        }

        if (details.statusCode === 404) {
            return '请求的资源不存在';
        }

        if (details.isClientError) {
            return `请求错误 (${details.statusCode})，请检查输入参数`;
        }

        return details.message || '发生未知错误，请重试';
    }
};

// Export default API client for convenience
export default apiClient;
