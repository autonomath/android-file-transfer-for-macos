import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { QuitUsbAppRequest, QuitUsbAppResult, UsbConflict } from '../../shared/types';

export function UsbConflictPanel({ phoneName, conflict, requestQuit }: {
  phoneName: string;
  conflict?: UsbConflict;
  requestQuit: (request: QuitUsbAppRequest) => Promise<QuitUsbAppResult>;
}): JSX.Element {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState('');

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

  return (
    <div className="connection-gate-copy usb-conflict">
      <h1>Another app is using your phone</h1>
      <p>
        {phoneName} is connected, but its file connection is already in use.
        We’ll keep checking and connect when it’s available.
      </p>
      <p className="usb-conflict-assurance">Nothing will be closed automatically.</p>
      <button
        type="button"
        className="primary-button usb-conflict-wait"
        onClick={() => setFeedback('Still waiting. All other apps have been left open; we’ll connect when the phone is available.')}
      >
        Keep waiting
      </button>
      {conflict?.apps.length ? (
        <div className="usb-conflict-apps">
          {conflict.apps.map((client) => (
            <section className="usb-conflict-app" key={client.id} aria-label={client.name}>
              <div>
                <h2>{client.name}</h2>
                <p className="usb-conflict-evidence">Active camera-import client</p>
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
      ) : (
        <p className="usb-conflict-unknown">
          We couldn’t verify which app is using the connection. If you’re ready, quit a camera-import
          app such as Google Drive, Preview, or Photos from its own menu—or leave this window open to wait.
        </p>
      )}
      <p className="usb-conflict-feedback" role="status" aria-live="polite">{feedback || 'Checking automatically.'}</p>
    </div>
  );
}
