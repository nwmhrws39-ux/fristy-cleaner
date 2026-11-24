import type { FristyApi } from '@shared/api';

declare global {
  interface Window {
    fristy: FristyApi;
  }
}

export const api: FristyApi = window.fristy;
