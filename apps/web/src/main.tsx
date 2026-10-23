import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import ApiKeyGate from './components/ApiKeyGate';
import { ButtonFeedback } from './components/ButtonFeedback';
import './styles.css';

const queryClient = new QueryClient();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ButtonFeedback client={queryClient}>
    <ApiKeyGate>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </QueryClientProvider>
    </ApiKeyGate>
    </ButtonFeedback>
  </React.StrictMode>,
);
