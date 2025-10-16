import React, { useState, useEffect } from 'react';

interface ErrorNotificationProps {
  error: Error | string | null;
  onClose?: () => void;
  duration?: number;
}

export const ErrorNotification: React.FC<ErrorNotificationProps> = ({
  error,
  onClose,
  duration = 5000
}) => {
  const [isVisible, setIsVisible] = useState(!!error);

  useEffect(() => {
    setIsVisible(!!error);
  }, [error]);

  useEffect(() => {
    if (isVisible && duration > 0) {
      const timer = setTimeout(() => {
        setIsVisible(false);
        onClose?.();
      }, duration);

      return () => clearTimeout(timer);
    }
  }, [isVisible, duration, onClose]);

  if (!isVisible || !error) {
    return null;
  }

  const errorMessage = typeof error === 'string' ? error : error.message;

  return (
    <div
      style={{
        position: 'fixed',
        top: '20px',
        right: '20px',
        backgroundColor: '#ff6b6b',
        color: 'white',
        padding: '15px 20px',
        borderRadius: '8px',
        boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
        zIndex: 10000,
        maxWidth: '400px',
        fontSize: '14px',
        lineHeight: '1.4'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
        <span style={{ fontSize: '18px', minWidth: '20px' }}>⚠️</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 'bold', marginBottom: '5px' }}>发生错误</div>
          <div>{errorMessage}</div>
        </div>
        <button
          onClick={() => {
            setIsVisible(false);
            onClose?.();
          }}
          style={{
            background: 'none',
            border: 'none',
            color: 'white',
            fontSize: '18px',
            cursor: 'pointer',
            padding: '0',
            width: '20px',
            height: '20px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          ×
        </button>
      </div>
    </div>
  );
};

// Hook to show error notifications
export const useErrorNotification = () => {
  const [error, setError] = useState<Error | string | null>(null);

  const showError = (error: Error | string) => {
    setError(error);
  };

  const clearError = () => {
    setError(null);
  };

  const ErrorNotificationComponent = () => (
    <ErrorNotification
      error={error}
      onClose={clearError}
      duration={5000}
    />
  );

  return {
    showError,
    clearError,
    ErrorNotification: ErrorNotificationComponent
  };
};

export default ErrorNotification;