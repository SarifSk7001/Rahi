// Shared runtime configuration for the frontend.
// Set VITE_API_URL in frontend/.env to point at a deployed backend, e.g.:
//   VITE_API_URL=https://api.example.com
export const API_URL = (import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000').replace(/\/$/, '')
