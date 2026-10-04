import type { MtpConnectionIssue, MtpConnectionPhase } from '../shared/types';

export const LIBMTP_OPEN_SESSION_TIMEOUT_MS = 5_000;
export const MTP_CONNECTION_WATCHDOG_MS = 10_000;

// Ownership was observed before opening the helper. Do not infer this result
// from user-facing wording or stderr left over from an earlier session.
export class MtpUsbBusyError extends Error {}

export function classifyMtpConnectionIssue(error: unknown, stderr: string): MtpConnectionIssue {
  if (error instanceof MtpUsbBusyError) return 'other-app-owns-usb';
  const rawMessage = error instanceof Error ? error.message : String(error);
  const combined = `${rawMessage}\n${stderr}`.toLowerCase();
  if (combined.includes('canceled') || combined.includes('cancelled') || combined.includes('stopped by user')) {
    return 'cancelled';
  }
  if (
    combined.includes('libusb_claim_interface') ||
    combined.includes('libusb_error_access') ||
    combined.includes('access denied') ||
    combined.includes('libusb_error_busy') ||
    combined.includes('another process has device opened for exclusive access')
  ) {
    return 'other-app-owns-usb';
  }
  if (
    combined.includes('ptp_error_io') ||
    combined.includes('failed to open session') ||
    combined.includes('unable to initialize device')
  ) {
    return 'phone-not-responding';
  }
  if (combined.includes('no device') || combined.includes('no longer available') || combined.includes('disappeared')) {
    return 'disconnected';
  }
  if (combined.includes('helper') && (combined.includes('missing') || combined.includes('not executable'))) {
    return 'helper-unavailable';
  }
  return 'unknown';
}

export function connectionPhaseForIssue(issue: MtpConnectionIssue): MtpConnectionPhase {
  if (issue === 'cancelled') {
    return 'cancelled';
  }
  if (issue === 'other-app-owns-usb') {
    return 'usb-busy';
  }
  if (issue === 'disconnected') {
    return 'no-phone';
  }
  return 'needs-mode-reset';
}
