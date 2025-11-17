/**
 * WebSocket client for real-time job status updates
 */
import { useState, useEffect } from 'react';
import { API_SERVER_URL } from './api';

const sanitizeBaseUrl = (url: string): string => url.replace(/\/+$/, '');

const deriveWebSocketBaseUrl = (httpUrl: string | undefined | null): string => {
  const fallback = 'ws://localhost:8000';
  if (!httpUrl) {
    return fallback;
  }

  try {
    const parsed = new URL(httpUrl);
    parsed.protocol = parsed.protocol === 'https:' ? 'wss:' : 'ws:';
    parsed.pathname = '';
    parsed.search = '';
    parsed.hash = '';
    return sanitizeBaseUrl(parsed.toString());
  } catch (error) {
    if (httpUrl.startsWith('https://')) {
      return sanitizeBaseUrl(httpUrl.replace(/^https:/, 'wss:'));
    }
    if (httpUrl.startsWith('http://')) {
      return sanitizeBaseUrl(httpUrl.replace(/^http:/, 'ws:'));
    }
    return sanitizeBaseUrl(httpUrl);
  }
};

const DEFAULT_WS_BASE_URL = deriveWebSocketBaseUrl(API_SERVER_URL);

export interface WebSocketMessage {
  type: string;
  job_id?: number;
  filename?: string;
  status?: string;
  progress?: number;
  error?: string;
  message?: string;
  queue_position?: number;
  summary?: string;
}

export interface JobStatusUpdate {
  job_id: number;
  status: string;
  progress: number;
  error_message?: string;
  queue_position?: number;
}

export class JobWebSocketClient {
  private ws: WebSocket | null = null;
  private token: string;
  private baseUrl: string;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;
  private isConnecting = false;
  private onMessageCallback?: (message: WebSocketMessage) => void;
  private onStatusChangeCallback?: (jobId: number, status: string, progress: number) => void;
  private onErrorCallback?: (error: string) => void;

  constructor(token: string, baseUrl: string = DEFAULT_WS_BASE_URL) {
    this.token = token;
    this.baseUrl = baseUrl;
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.isConnecting || (this.ws && this.ws.readyState === WebSocket.OPEN)) {
        resolve();
        return;
      }

      this.isConnecting = true;

      try {
        const wsUrl = `${this.baseUrl}/ws/${this.token}`;

        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
          this.isConnecting = false;
          this.reconnectAttempts = 0;
          resolve();
        };

        this.ws.onmessage = (event) => {
          try {
            const message: WebSocketMessage = JSON.parse(event.data);

            // Call general message callback
            if (this.onMessageCallback) {
              this.onMessageCallback(message);
            }

            // Call specific status change callback
            if (message.job_id && message.status !== undefined) {
              if (this.onStatusChangeCallback) {
                this.onStatusChangeCallback(
                  message.job_id,
                  message.status,
                  message.progress || 0
                );
              }
            }

            // Handle error messages
            if (message.type === 'error' && this.onErrorCallback) {
              this.onErrorCallback(message.message || 'Unknown error');
            }

          } catch (error) {
            // Ignore malformed messages
          }
        };

        this.ws.onclose = (event) => {
          this.isConnecting = false;
          this.ws = null;

          // Attempt to reconnect if not a normal closure
          if (event.code !== 1000 && this.reconnectAttempts < this.maxReconnectAttempts) {
            this.scheduleReconnect();
          }
        };

        this.ws.onerror = (error) => {
          this.isConnecting = false;
          reject(error);
        };

      } catch (error) {
        this.isConnecting = false;
        reject(error);
      }
    });
  }

  private scheduleReconnect() {
    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);

    setTimeout(() => {
      this.connect().catch(() => {
        // Silently handle reconnection failures
      });
    }, delay);
  }

  disconnect() {
    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
    }
  }

  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  // Event handlers
  onMessage(callback: (message: WebSocketMessage) => void) {
    this.onMessageCallback = callback;
  }

  onStatusChange(callback: (jobId: number, status: string, progress: number) => void) {
    this.onStatusChangeCallback = callback;
  }

  onError(callback: (error: string) => void) {
    this.onErrorCallback = callback;
  }

  // Static method to create client from localStorage token
  static fromLocalStorage(baseUrl: string = DEFAULT_WS_BASE_URL): JobWebSocketClient {
    const token = localStorage.getItem('token');
    if (!token) {
      throw new Error('No authentication token found in localStorage');
    }
    return new JobWebSocketClient(token, baseUrl);
  }
}

// Hook for React components
export const useJobWebSocket = () => {
  const [wsClient, setWsClient] = useState<JobWebSocketClient | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    try {
      const client = JobWebSocketClient.fromLocalStorage();

      client.onStatusChange((jobId, status, progress) => {
        // This will be handled by the component using the hook
      });

      client.connect().then(() => {
        setWsClient(client);
        setIsConnected(true);
      }).catch(() => {
        // Silently handle connection failures
      });

      return () => {
        client.disconnect();
      };
    } catch (error) {
      // Silently handle client creation failures
    }
  }, []);

  return { wsClient, isConnected };
};