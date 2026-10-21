/// <reference types="vite/client" />

import type { ApiElectron } from '../../shared/types/api.types';

declare global {
  interface Window {
    api: ApiElectron;
  }
}
