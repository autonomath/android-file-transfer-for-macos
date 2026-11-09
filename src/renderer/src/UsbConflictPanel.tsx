import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { QuitUsbAppRequest, QuitUsbAppResult, UsbConflict } from '../../shared/types';

export function UsbConflictPanel({ phoneName, conflict, requestQuit, releaseConnection }: {
  phoneName: string;
  conflict?: UsbConflict;
  requestQuit: (request: QuitUsbAppRequest) => Promise<QuitUsbAppResult>;
  releaseConnection: (connectionId: string) => Promise<QuitUsbAppResult>;
}): JSX.Element {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState('');
  const appIds = conflict?.apps.map((client) => client.id).join(',') ?? '';
  // A message about an app that has since let go (for example "Quit requested") is no longer true.
  useEffect(() => setFeedback(''), [appIds]);

  async function quit(appId: string): Promise<void> {
    if (!conflict || pendingId) return;
    setPendingId(appId);
    setFeedback('Sending a normal Quit request…');
    try {
      const result = await requestQuit({ connectionId: conflict.connectionId, appId });
      setFeedback(result.message);
    } catch {
      setFeedback('Could not request Quit. You can use the app’s own Quit menu, or keep waiting. Nothing was force-quit.');
    } finally {
      setPendingId(null);
    }
  }

  async function release(): Promise<void> {
    if (!conflict || pendingId) return;
    setPendingId('release');
    setFeedback('Releasing the phone…');
    try {
      setFeedback((await releaseConnection(conflict.connectionId)).message);
    } catch {
      setFeedback('Could not release the phone. Unplug it and plug it back in.');
    } finally {
      setPendingId(null);
    }
  }

  return (
    <div className="connection-gate-copy usb-conflict">
      <h1>{conflict && !conflict.apps.length ? 'macOS is holding your phone' : 'Another app is using your phone'}</h1>
      <p>
        {phoneName} is connected, but its file connection is already in use.
        We’ll keep checking and connect when it’s available.
      </p>
      <p className="usb-conflict-assurance">Nothing will be closed automatically.</p>
      {conflict?.apps.length ? (
        <div className="usb-conflict-apps">
          {conflict.apps.some((client) => !client.verified) ? (
            <p className="usb-conflict-unknown">
              We couldn’t confirm which app has it. These open apps can use phones, so one of them is the likely cause.
            </p>
          ) : null}
          {conflict.apps.map((client) => (
            <section className="usb-conflict-app" key={client.id} aria-label={client.name}>
              <div>
                <h2>{client.name}</h2>
                <p className="usb-conflict-evidence">{client.verified ? 'Active camera-import client' : 'Possible cause'}</p>
                <p className="usb-conflict-impact" id={`impact-${client.id}`}>{client.quitImpact}</p>
              </div>
              <button
                type="button"
                className="text-button usb-conflict-quit"
                disabled={pendingId !== null}
                aria-describedby={`impact-${client.id}`}
                onClick={() => void quit(client.id)}
              >
                {pendingId === client.id ? <Loader2 size={15} className="spin" /> : null}
                {pendingId === client.id ? 'Requesting Quit…' : `Request ${client.name} to quit`}
              </button>
            </section>
          ))}
          <p className="usb-conflict-footnote">A normal Quit request lets the app finish work, show a save prompt, or decline. You can reopen it when you need it again.</p>
        </div>
      ) : conflict ? (
        <div className="usb-conflict-apps">
          <section className="usb-conflict-app" aria-label="macOS camera import">
            <div>
              <h2>macOS camera import</h2>
              <p className="usb-conflict-evidence">No app is using it</p>
              <p className="usb-conflict-impact" id="impact-camera-import">
                macOS kept the phone after the last app that used it let go. Releasing it closes nothing you have
                open; macOS starts camera import again when an app asks for it.
              </p>
            </div>
            <button
              type="button"
              className="text-button usb-conflict-quit"
              disabled={pendingId !== null}
              aria-describedby="impact-camera-import"
              onClick={() => void release()}
            >
              {pendingId === 'release' ? <Loader2 size={15} className="spin" /> : null}
              {pendingId === 'release' ? 'Releasing…' : 'Release the phone'}
            </button>
          </section>
        </div>
      ) : (
        <p className="usb-conflict-unknown">
          We couldn’t tell which app is using the connection. If you’re ready, quit any photo, backup, or
          Android transfer app from its own menu—or leave this window open to wait.
        </p>
      )}
      <p className="usb-conflict-feedback" role="status" aria-live="polite">{feedback || 'Checking automatically.'}</p>
    </div>
  );
}
