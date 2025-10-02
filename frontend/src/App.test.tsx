import React from 'react';
import { render, screen } from '@testing-library/react';

jest.mock('axios', () => {
  const mockAxiosInstance = {
    interceptors: {
      request: { use: jest.fn() },
      response: { use: jest.fn() },
    },
    get: jest.fn(),
    post: jest.fn(),
  };
  return {
    __esModule: true,
    default: {
      create: jest.fn(() => mockAxiosInstance),
      post: jest.fn(),
      get: jest.fn(),
    },
  };
});

jest.mock('./pages/DashboardPage', () => ({
  DashboardPage: () => <div>Mock Dashboard</div>,
}));

jest.mock('./pages/JobDetailPage', () => ({
  JobDetailPage: () => <div>Mock Job Detail</div>,
}));

jest.mock('./pages/RegisterPage', () => ({
  RegisterPage: () => <div>Mock Register</div>,
}));

import App from './App';

test('shows login page when user is not authenticated', () => {
  localStorage.removeItem('token');
  render(<App />);
  expect(screen.getByRole('heading', { name: /login/i })).toBeInTheDocument();
});
