import axios from 'axios';

const API_SERVER_URL = process.env.REACT_APP_API_URL || "http://localhost:8000";

export const apiClient = axios.create({ baseURL: API_SERVER_URL });

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
    return config;
});

// Add response interceptor to handle token expiration and other authentication issues
apiClient.interceptors.response.use(
    response => response,
    error => {
        // Check if the error is due to unauthorized access (token expired or invalid)
        if (error.response && error.response.status === 401) {
            // Remove the invalid token
            localStorage.removeItem('token');
            // Redirect to login page
            window.location.href = '/login';
        }
        return Promise.reject(error);
    }
);

export type ChatRole = 'user' | 'assistant' | 'system';

export interface ChatMessagePayload {
    role: ChatRole;
    content: string;
}

export interface ChatResponse {
    reply: string;
}

export const sendAssistantChat = async (messages: ChatMessagePayload[], systemPrompt?: string) => {
    const response = await apiClient.post<ChatResponse>('/assistant/chat', {
        messages,
        systemPrompt,
    });
    return response.data;
};

// 流式聊天接口
export const sendAssistantChatStream = async (
    messages: ChatMessagePayload[],
    systemPrompt?: string,
    onChunk?: (chunk: string) => void,
    onComplete?: () => void,
    onError?: (error: string) => void
) => {
    try {
        const token = localStorage.getItem('token');

        const requestData = {
            messages,
            systemPrompt,
        };

        const response = await fetch(`${API_SERVER_URL}/assistant/chat/stream`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
                'Accept': 'text/event-stream',
                'Cache-Control': 'no-cache',
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
