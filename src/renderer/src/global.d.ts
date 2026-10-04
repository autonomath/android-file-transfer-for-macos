import type { MtpApi } from '../../shared/types';

declare global {
  interface Window {
    mtp: MtpApi;
  }
}

export {};
