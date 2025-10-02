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
