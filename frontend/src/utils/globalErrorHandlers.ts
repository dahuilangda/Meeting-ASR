// Global error handlers for unhandled errors and promise rejections

// Type declaration for gtag
declare global {
  interface Window {
    gtag?: (command: string, eventName: string, params?: any) => void;
  }
}

export const setupGlobalErrorHandlers = () => {
  // Handle unhandled promise rejections
  const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
    console.error('Unhandled promise rejection:', event.reason);

    // Prevent the default browser behavior
    event.preventDefault();

    // You could send this error to an error reporting service here
    // For now, we'll just log it
    if (typeof window !== 'undefined' && window.gtag) {
      window.gtag('event', 'exception', {
        description: event.reason?.message || 'Unhandled promise rejection',
        fatal: false
      });
    }
  };

  // Handle uncaught errors
  const handleError = (event: ErrorEvent) => {
    console.error('Uncaught error:', event.error || event.message);

    // Filter out extension-related errors
    if (event.filename && event.filename.includes('content_script.js')) {
      // This is likely a browser extension error, ignore it
      return;
    }

    if (event.filename && event.filename.includes('chrome-extension://')) {
      // Chrome extension error, ignore it
      return;
    }

    if (event.message && event.message.includes('fetchError: Failed to fetch')) {
      // This is likely from a browser extension, ignore it
      return;
    }

    // You could send this error to an error reporting service here
    if (typeof window !== 'undefined' && window.gtag) {
      window.gtag('event', 'exception', {
        description: event.message,
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
        fatal: false
      });
    }
  };

  // Handle window errors
  const handleWindowError = (message: string | Event, source?: string, lineno?: number, colno?: number, error?: Error) => {
    console.error('Window error:', { message, source, lineno, colno, error });

    // Filter out extension-related errors
    if (source && (source.includes('content_script.js') || source.includes('chrome-extension://'))) {
      return true; // Prevent default error handling
    }

    if (typeof message === 'string' && message.includes('fetchError: Failed to fetch')) {
      return true; // Prevent default error handling
    }

    // You could send this error to an error reporting service here
    if (typeof window !== 'undefined' && window.gtag) {
      window.gtag('event', 'exception', {
        description: typeof message === 'string' ? message : 'Unknown window error',
        filename: source,
        lineno: lineno,
        colno: colno,
        fatal: false
      });
    }

    return false; // Let default error handling proceed
  };

  // Add event listeners
  window.addEventListener('unhandledrejection', handleUnhandledRejection);
  window.addEventListener('error', handleError);

  // Handle window.onerror separately for better error filtering
  const originalOnError = window.onerror;
  window.onerror = handleWindowError;

  // Return cleanup function
  return () => {
    window.removeEventListener('unhandledrejection', handleUnhandledRejection);
    window.removeEventListener('error', handleError);
    window.onerror = originalOnError;
  };
};

// Log browser and environment info for debugging
export const logEnvironmentInfo = () => {
  const info = {
    userAgent: navigator.userAgent,
    language: navigator.language,
    platform: navigator.platform,
    cookieEnabled: navigator.cookieEnabled,
    onLine: navigator.onLine,
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight
    },
    screen: {
      width: window.screen?.width || 0,
      height: window.screen?.height || 0
    },
    url: window.location.href,
    timestamp: new Date().toISOString()
  };

  console.log('Environment Info:', info);
};