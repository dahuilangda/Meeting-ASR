import React, { useState, useEffect } from 'react';
import { NetworkErrorHandler } from '../api';

interface NetworkStatusProps {
  children?: React.ReactNode;
}

export const NetworkStatus: React.FC<NetworkStatusProps> = ({ children }) => {
  const [showOfflineWarning, setShowOfflineWarning] = useState(!NetworkErrorHandler.isOnline());

  useEffect(() => {
    const cleanup = NetworkErrorHandler.onStatusChange((online) => {
      setShowOfflineWarning(!online);
    });

    return cleanup;
  }, []);

  if (!showOfflineWarning) {
    return <>{children}</>;
  }

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      backgroundColor: '#ff6b6b',
      color: 'white',
      padding: '10px',
      textAlign: 'center',
      zIndex: 9999,
      boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px' }}>
        <span>🌐</span>
        <span>网络连接已断开，请检查您的网络连接</span>
        <button
          onClick={() => setShowOfflineWarning(false)}
          style={{
            background: 'none',
            border: '1px solid white',
            color: 'white',
            padding: '2px 8px',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '12px'
          }}
        >
          忽略
        </button>
      </div>
    </div>
  );
};

export default NetworkStatus;