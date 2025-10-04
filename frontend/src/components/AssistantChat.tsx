import React, { useEffect, useMemo, useRef, useState } from 'react';
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
    content: '你好，我是你的会议智能助手。可以向我提问会议内容、总结重点或生成行动项！'
  }]);
  const [userInput, setUserInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showQuickPrompts, setShowQuickPrompts] = useState(true);

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
      const friendlyError = err instanceof Error ? err.message : '无法获取助理回复，请稍后重试。';
      setError(friendlyError);
      appendMessage({
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: '抱歉，我暂时无法处理这个请求。请稍后再试一次。'
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
      content: '会话已重置。请告诉我你想了解的会议内容。'
    }]);
    setError(null);
    setUserInput('');
  };

  return (
    <div className="assistant-chat shadow-lg border rounded-4 bg-white" style={{
      position: 'fixed',
      bottom: '2rem',
      right: '2rem',
      width: '380px',
      maxWidth: '90vw',
      height: '520px',
      display: 'flex',
      flexDirection: 'column',
      zIndex: 1050
    }}>
      <div className="d-flex justify-content-between align-items-center px-3 py-2 border-bottom" style={{ borderTopLeftRadius: '1rem', borderTopRightRadius: '1rem' }}>
        <div>
          <strong>会议助理 Copilot</strong>
          <div className="text-muted" style={{ fontSize: '0.8rem' }}>{job.filename}</div>
        </div>
        <div className="d-flex gap-2">
          <button className="btn btn-sm btn-outline-secondary" onClick={handleReset} disabled={isSending}>
            重置
          </button>
          <button className="btn btn-sm btn-outline-danger" onClick={onClose}>
            关闭
          </button>
        </div>
      </div>

      {showQuickPrompts && (
        <div className="px-3 py-2 border-bottom" style={{ backgroundColor: '#f8f9fa' }}>
          <div className="d-flex justify-content-between align-items-center mb-2">
            <small className="text-muted">快捷提问</small>
            <button
              type="button"
              className="btn btn-sm btn-outline-secondary"
              onClick={() => setShowQuickPrompts(false)}
            >
              隐藏
            </button>
          </div>
          <div className="d-flex gap-2 flex-wrap">
            {QUICK_PROMPTS.map(prompt => (
              <button
                key={prompt}
                type="button"
                className="btn btn-sm btn-outline-primary"
                onClick={() => handleQuickPrompt(prompt)}
                disabled={isSending}
              >
                {prompt}
              </button>
            ))}
          </div>
        </div>
      )}

      <div ref={scrollRef} className="flex-grow-1 px-3 py-3" style={{ overflowY: 'auto', fontSize: '0.9rem', backgroundColor: '#fff' }}>
        {messages.map(message => (
          <div key={message.id} className={`d-flex mb-3 ${message.role === 'user' ? 'justify-content-end' : 'justify-content-start'}`}>
            <div className={`p-2 rounded-3 ${message.role === 'user' ? 'bg-primary text-white' : 'bg-light border'}`} style={{ maxWidth: '85%' }}>
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
            <div className="p-2 rounded-3 bg-light border" style={{ maxWidth: '85%' }}>
              <span className="spinner-border spinner-border-sm me-2" role="status"></span>
              正在思考...
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="alert alert-warning mx-3 my-2 py-2" style={{ fontSize: '0.85rem' }}>
          {error}
        </div>
      )}

      <form onSubmit={handleSend} className="p-3 border-top" style={{ borderBottomLeftRadius: '1rem', borderBottomRightRadius: '1rem' }}>
        <div className="form-floating">
          <textarea
            id="assistant-chat-input"
            className="form-control"
            placeholder="向助理提问..."
            style={{ minHeight: '80px', resize: 'none' }}
            value={userInput}
            onChange={event => setUserInput(event.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isSending}
          />
          <label htmlFor="assistant-chat-input">向助理提问...</label>
        </div>
        <div className="d-flex justify-content-between align-items-center mt-2">
          <small className="text-muted">按 Enter 发送，Shift+Enter 换行</small>
          {!showQuickPrompts && (
            <button
              type="button"
              className="btn btn-sm btn-outline-secondary me-auto"
              onClick={() => setShowQuickPrompts(true)}
            >
              显示快捷提问
            </button>
          )}
          <button type="submit" className="btn btn-primary" disabled={isSending || !userInput.trim()}>
            {isSending ? (
              <>
                <span className="spinner-border spinner-border-sm me-1" role="status"></span>
                发送中
              </>
            ) : (
              '发送'
            )}
          </button>
        </div>
      </form>
    </div>
  );
};
