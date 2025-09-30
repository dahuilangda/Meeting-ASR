import React, { useState } from 'react';
import axios from 'axios';

const API_SERVER_URL = "http://localhost:8000";

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export function Chat() {
  const [messages, setMessages] = useState<Message[]>([{ role: 'assistant', content: 'Hello! How can I help you today?' }]);
  const [userInput, setUserInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userInput.trim()) return;

    const userMessage: Message = { role: 'user', content: userInput };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setUserInput('');
    setIsLoading(true);

    try {
      const response = await axios.post(`${API_SERVER_URL}/chat`, { messages: newMessages });
      const assistantMessage = response.data;
      setMessages(prev => [...prev, assistantMessage]);
    } catch (error) {
      console.error("Chat failed:", error);
      const errorMessage: Message = { role: 'assistant', content: 'Sorry, I encountered an error.' };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="d-flex flex-column h-100" style={{ maxHeight: '70vh' }}>
      <div className="flex-grow-1 overflow-auto p-3 bg-light rounded">
        {messages.map((msg, index) => (
          <div key={index} className={`mb-3 d-flex ${msg.role === 'user' ? 'justify-content-end' : 'justify-content-start'}`}>
            <div 
              className={`p-2 rounded shadow-sm w-75 ${msg.role === 'user' ? 'bg-primary text-white' : 'bg-white'}`}
              style={{ whiteSpace: 'pre-wrap' }}
            >
              {msg.content}
            </div>
          </div>
        ))}
        {isLoading && <div className="text-muted">Assistant is typing...</div>}
      </div>
      <form onSubmit={handleSendMessage} className="mt-3 d-flex">
        <input
          type="text"
          className="form-control me-2"
          value={userInput}
          onChange={(e) => setUserInput(e.target.value)}
          placeholder="Type your message..."
          disabled={isLoading}
        />
        <button type="submit" className="btn btn-primary" disabled={isLoading}>Send</button>
      </form>
    </div>
  );
}
