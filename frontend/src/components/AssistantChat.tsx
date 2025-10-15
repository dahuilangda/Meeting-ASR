import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ChatMessagePayload, ChatResponse, sendAssistantChat } from '../api';

export interface AssistantChatJobContext {
  id: number;
  filename: string;
  status: string;
  created_at: string;
  summary: string | null;
  transcript: string | null;
}

type ConversationMessage = ChatMessagePayload & { id: string };

interface AssistantChatProps {
  job: AssistantChatJobContext;
  onClose: () => void;
}

const QUICK_PROMPTS: string[] = [
  '请根据会议内容列出关键行动项。',
  '会议中提到了哪些风险和阻碍？',
  '帮我总结会议中的关键决策。'
];

const truncate = (value: string | null, maxLength = 2000) => {
  if (!value) return '';
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}...`;
};

export const AssistantChat: React.FC<AssistantChatProps> = ({ job, onClose }) => {
  const [messages, setMessages] = useState<ConversationMessage[]>([{
    id: 'welcome',
    role: 'assistant',
    content: 'Hello! I am your AI meeting assistant. You can ask me questions about the meeting content, summarize key points, or generate action items!'
  }]);
  const [userInput, setUserInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showQuickPrompts, setShowQuickPrompts] = useState(true);

  // Draggable and resizable state
  const [position, setPosition] = useState({ x: window.innerWidth - 400, y: window.innerHeight - 600 });
  const [size, setSize] = useState({ width: 380, height: 520 });
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [resizeStart, setResizeStart] = useState({ x: 0, y: 0, width: 0, height: 0 });
  const [isMinimized, setIsMinimized] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);

  const systemPrompt = useMemo(() => {
    const meetingDate = new Date(job.created_at).toLocaleString();
    const summarySnippet = truncate(job.summary, 2000);
    const transcriptSnippet = truncate(job.transcript, 2000);

    let prompt = `You are an experienced meeting copilot helping the user work with transcripts and summaries. ` +
      `Provide concise answers using Markdown when appropriate. If the user writes in Chinese, respond in Chinese; otherwise follow their language. ` +
      `Use bullet lists for action items, and always double-check facts before presenting them.`;

    prompt += `\n\nMeeting metadata:\n- File name: ${job.filename}\n- Status: ${job.status}\n- Created at: ${meetingDate}`;

    if (summarySnippet) {
      prompt += `\n\nExisting meeting summary (参考):\n${summarySnippet}`;
    }
    if (transcriptSnippet) {
      prompt += `\n\nTranscript excerpt (可能不完整):\n${transcriptSnippet}`;
    }
    return prompt;
  }, [job]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const appendMessage = (message: ConversationMessage) => {
    setMessages(prev => [...prev, message]);
  };

  const handleSend = async (event?: React.FormEvent) => {
    event?.preventDefault();
    const trimmed = userInput.trim();
    if (!trimmed || isSending) {
      return;
    }

    setError(null);

    const userMessage: ConversationMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: trimmed,
    };
    appendMessage(userMessage);
    setUserInput('');
    setIsSending(true);

    try {
      const history: ChatMessagePayload[] = [...messages, userMessage]
        .map(({ role, content }) => ({ role, content }));

      const response: ChatResponse = await sendAssistantChat(history, systemPrompt);
      appendMessage({
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: response.reply
      });
    } catch (err) {
      console.error('Assistant chat failed', err);
      const friendlyError = err instanceof Error ? err.message : 'Unable to get assistant response, please try again later.';
      setError(friendlyError);
      appendMessage({
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: 'Sorry, I am currently unable to process this request. Please try again later.'
      });
    } finally {
      setIsSending(false);
    }
  };

  const handleQuickPrompt = (prompt: string) => {
    setUserInput(prompt);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  };

  const handleReset = () => {
    setMessages([{
      id: 'welcome',
      role: 'assistant',
      content: 'Conversation has been reset. Please tell me what you would like to know about the meeting.'
    }]);
    setError(null);
    setUserInput('');
  };

  // Mouse event handlers for dragging
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.target instanceof HTMLElement && e.target.classList.contains('resize-handle')) {
      // Start resizing
      e.preventDefault();
      setIsResizing(true);
      setResizeStart({
        x: e.clientX,
        y: e.clientY,
        width: size.width,
        height: size.height
      });
    } else if (e.target instanceof HTMLElement && e.target.closest('.drag-handle')) {
      // Start dragging
      e.preventDefault();
      setIsDragging(true);
      setDragStart({
        x: e.clientX - position.x,
        y: e.clientY - position.y
      });
    }
  };

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (isDragging) {
      const newX = e.clientX - dragStart.x;
      const newY = e.clientY - dragStart.y;

      // Constrain to viewport
      const maxX = window.innerWidth - 100;
      const maxY = window.innerHeight - 100;

      setPosition({
        x: Math.max(0, Math.min(newX, maxX)),
        y: Math.max(0, Math.min(newY, maxY))
      });
    } else if (isResizing) {
      const deltaX = e.clientX - resizeStart.x;
      const deltaY = e.clientY - resizeStart.y;

      const newWidth = Math.max(320, Math.min(800, resizeStart.width + deltaX));
      const newHeight = Math.max(200, Math.min(window.innerHeight - 100, resizeStart.height + deltaY));

      setSize({ width: newWidth, height: newHeight });
    }
  }, [isDragging, isResizing, dragStart, resizeStart]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
    setIsResizing(false);
  }, []);

  useEffect(() => {
    if (isDragging || isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.userSelect = 'none';
      document.body.style.cursor = isResizing ? 'nwse-resize' : 'move';

      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        document.body.style.userSelect = '';
        document.body.style.cursor = '';
      };
    }
  }, [isDragging, isResizing, handleMouseMove, handleMouseUp]);

  return (
    <>
      <style>
        {`
          .assistant-chat {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          }
          .assistant-chat.dragging {
            opacity: 1;
          }
          .assistant-chat.resizing {
            opacity: 1;
          }
          .drag-handle {
            user-select: none;
          }
          .resize-handle:hover {
            opacity: 1 !important;
            background: linear-gradient(135deg, transparent 40%, #adb5bd 40%) !important;
          }
          .assistant-chat .btn-sm {
            font-weight: 400;
          }
          .assistant-chat .form-control-sm {
            border-radius: 0.5rem;
          }
          .assistant-chat::-webkit-scrollbar {
            width: 6px;
          }
          .assistant-chat::-webkit-scrollbar-track {
            background: #f8f9fa;
            border-radius: 3px;
          }
          .assistant-chat::-webkit-scrollbar-thumb {
            background: #dee2e6;
            border-radius: 3px;
          }
          .assistant-chat::-webkit-scrollbar-thumb:hover {
            background: #ced4da;
          }
        `}
      </style>
      <div
        ref={containerRef}
        className={`assistant-chat shadow-lg border rounded-4 bg-white ${isDragging ? 'dragging' : ''} ${isResizing ? 'resizing' : ''}`}
        style={{
          position: 'fixed',
          left: `${position.x}px`,
          top: `${position.y}px`,
          width: `${size.width}px`,
          height: isMinimized ? '48px' : `${size.height}px`,
          display: 'flex',
          flexDirection: 'column',
          zIndex: 1050,
          transition: isDragging || isResizing ? 'none' : 'none',
          resize: 'none',
          boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)',
          border: '1px solid rgba(0, 0, 0, 0.1)'
        }}
        onMouseDown={handleMouseDown}
      >
      {/* Header */}
      <div className="drag-handle d-flex justify-content-between align-items-center px-3 py-2 border-bottom bg-light"
           style={{ borderTopLeftRadius: '1rem', borderTopRightRadius: '1rem', cursor: 'move', color: '#495057' }}>
        <div className="d-flex align-items-center gap-2">
          <i className="bi bi-robot"></i>
          <div>
            <strong style={{ fontSize: '0.9rem' }}>AI Assistant</strong>
            <div className="text-muted" style={{ fontSize: '0.75rem' }}>{job.filename}</div>
          </div>
        </div>
        <div className="d-flex gap-1">
          {!isMinimized && (
            <button
              className="btn btn-sm btn-outline-secondary border-0 p-1"
              onClick={() => setShowQuickPrompts(!showQuickPrompts)}
              style={{ fontSize: '0.8rem', minWidth: '24px', height: '24px' }}
              title={showQuickPrompts ? "Hide Quick Questions" : "Show Quick Questions"}
            >
              <i className="bi bi-lightning"></i>
            </button>
          )}
          <button
            className="btn btn-sm btn-outline-secondary border-0 p-1"
            onClick={() => setIsMinimized(!isMinimized)}
            style={{ fontSize: '0.8rem', minWidth: '24px', height: '24px' }}
            title={isMinimized ? "Expand" : "Minimize"}
          >
            <i className={`bi bi-${isMinimized ? 'caret-down-fill' : 'caret-up-fill'}`}></i>
          </button>
          <button
            className="btn btn-sm btn-outline-secondary border-0 p-1"
            onClick={handleReset}
            disabled={isSending}
            style={{ fontSize: '0.8rem', minWidth: '24px', height: '24px' }}
            title="Reset"
          >
            <i className="bi bi-arrow-clockwise"></i>
          </button>
          <button
            className="btn btn-sm btn-outline-secondary border-0 p-1"
            onClick={onClose}
            style={{ fontSize: '0.8rem', minWidth: '24px', height: '24px' }}
            title="Close"
          >
            <i className="bi bi-x-lg"></i>
          </button>
        </div>
      </div>

      {!isMinimized && showQuickPrompts && (
        <div className="px-3 py-2 border-bottom" style={{ backgroundColor: '#f8f9fa' }}>
          <div className="d-flex align-items-center mb-2">
            <small className="text-muted">Quick Questions</small>
          </div>
          <div className="d-flex gap-1 flex-wrap">
            {QUICK_PROMPTS.map(prompt => (
              <button
                key={prompt}
                type="button"
                className="btn btn-sm btn-outline-primary"
                onClick={() => handleQuickPrompt(prompt)}
                disabled={isSending}
                style={{ fontSize: '0.75rem', padding: '3px 6px' }}
              >
                {prompt.length > 20 ? prompt.substring(0, 20) + '...' : prompt}
              </button>
            ))}
          </div>
        </div>
      )}

      {!isMinimized && (
        <div ref={scrollRef} className="flex-grow-1 px-3 py-2" style={{ overflowY: 'auto', fontSize: '0.85rem', backgroundColor: '#fff' }}>
          {messages.map(message => (
            <div key={message.id} className={`d-flex mb-2 ${message.role === 'user' ? 'justify-content-end' : 'justify-content-start'}`}>
              <div className={`p-2 rounded-3 ${message.role === 'user' ? 'bg-primary text-white' : 'bg-light border'}`} style={{ maxWidth: '90%' }}>
                {message.role === 'assistant' ? (
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
                ) : (
                  message.content.split('\n').map((line, idx) => (
                    <span key={idx}>
                      {line}
                      {idx !== message.content.split('\n').length - 1 && <br />}
                    </span>
                  ))
                )}
              </div>
            </div>
          ))}
          {isSending && (
            <div className="d-flex mb-2 justify-content-start">
              <div className="p-2 rounded-3 bg-light border" style={{ maxWidth: '90%' }}>
                <span className="spinner-border spinner-border-sm me-2" role="status"></span>
                Thinking...
              </div>
            </div>
          )}
        </div>
      )}

      {!isMinimized && error && (
        <div className="alert alert-warning mx-3 my-1 py-2" style={{ fontSize: '0.8rem' }}>
          {error}
        </div>
      )}

      {!isMinimized && (
        <form onSubmit={handleSend} className="p-2 border-top" style={{ borderBottomLeftRadius: '1rem', borderBottomRightRadius: '1rem' }}>
          <div className="d-flex gap-2 align-items-end">
            <div className="flex-grow-1">
              <textarea
                id="assistant-chat-input"
                className="form-control form-control-sm"
                placeholder="Ask anything..."
                style={{ minHeight: '36px', maxHeight: '80px', resize: 'none', fontSize: '0.85rem' }}
                value={userInput}
                onChange={event => setUserInput(event.target.value)}
                onKeyDown={handleKeyDown}
                disabled={isSending}
              />
            </div>
            <div className="d-flex gap-1">
              <button type="submit" className="btn btn-primary btn-sm" disabled={isSending || !userInput.trim()} style={{ fontSize: '0.8rem', padding: '6px 12px' }}>
                {isSending ? (
                  <span className="spinner-border spinner-border-sm" role="status"></span>
                ) : (
                  <i className="bi bi-send"></i>
                )}
              </button>
            </div>
          </div>
        </form>
      )}

      {/* Resize Handle */}
      {!isMinimized && (
        <div
          className="resize-handle"
          style={{
            position: 'absolute',
            bottom: '0',
            right: '0',
            width: '16px',
            height: '16px',
            cursor: 'nwse-resize',
            borderBottomRightRadius: '1rem',
            background: 'linear-gradient(135deg, transparent 50%, #dee2e6 50%)',
            opacity: 0.6,
            transition: 'none'
          }}
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setIsResizing(true);
            setResizeStart({
              x: e.clientX,
              y: e.clientY,
              width: size.width,
              height: size.height
            });
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.opacity = '1';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.opacity = '0.6';
          }}
        />
      )}
      </div>
    </>
  );
};
