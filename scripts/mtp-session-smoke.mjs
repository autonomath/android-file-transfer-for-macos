import { spawn } from 'node:child_process';
import { mkdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

const root = resolve(new URL('..', import.meta.url).pathname);
const helper = join(root, 'resources/bin/mtp-json');
const destinationDir = join(root, 'transfer-test');
const waitForNewAddress = process.argv.includes('--wait-for-new-address');
const timeoutArg = process.argv.find((arg) => arg.startsWith('--timeout-ms='));
const timeoutMs = timeoutArg ? Number(timeoutArg.split('=')[1]) : 5 * 60_000;
const minSizeArg = process.argv.find((arg) => arg.startsWith('--min-size='));
const minSize = minSizeArg ? Number(minSizeArg.split('=')[1]) : 0;
const preferExtArg = process.argv.find((arg) => arg.startsWith('--prefer-ext='));
const preferExt = preferExtArg ? preferExtArg.split('=')[1].replace(/^\./, '').toLowerCase() : '';
const rootParentId = 4294967295;

function runJson(args, timeout = 15_000) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(helper, args, { cwd: root });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      child.kill('SIGTERM');
      setTimeout(() => {
        if (!settled) child.kill('SIGKILL');
      }, 1500);
    }, timeout);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });
    child.on('close', (code, signal) => {
      settled = true;
      clearTimeout(timer);
      const line = stdout
        .split('\n')
        .map((item) => item.trim())
        .find((item) => item.startsWith('{'));
      if (!line) {
        rejectPromise(new Error(`no JSON from ${args.join(' ')} code=${code} signal=${signal}: ${stderr.trim()}`));
        return;
      }
      try {
        resolvePromise(JSON.parse(line));
      } catch (error) {
        rejectPromise(error);
      }
    });
  });
}

function rawKey(status) {
  const device = status.rawDevices?.[0];
  if (!device) return null;
  return `${device.bus}:${device.device}:${device.vendorId}:${device.productId}`;
}

async function waitForFreshAddress() {
  const initialStatus = await runJson(['status']);
  const initialKey = rawKey(initialStatus);
  console.error(`[status] initial key=${initialKey ?? 'none'} state=${initialStatus.state}`);

  if (!waitForNewAddress) {
    return;
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 1500));
    const status = await runJson(['status']).catch(() => null);
    const key = status ? rawKey(status) : null;
    if (key && key !== initialKey) {
      console.error(`[status] fresh key=${key}`);
      return;
    }
  }

  throw new Error(`timed out waiting for USB address change from ${initialKey ?? 'none'}`);
}

function runSessionSmoke() {
  mkdirSync(destinationDir, { recursive: true });

  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(helper, ['session', '0'], {
      cwd: root,
      env: { ...process.env, LIBUSB_DEBUG: process.env.LIBUSB_DEBUG ?? '2' }
    });
    let stdoutBuffer = '';
    let stderrBuffer = '';
    const pending = new Map();
    let readyResolve;
    let readyReject;
    const ready = new Promise((resolveReady, rejectReady) => {
      readyResolve = resolveReady;
      readyReject = rejectReady;
    });

    const hardTimer = setTimeout(() => {
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 1500);
      rejectPromise(new Error('single-session smoke test timed out'));
    }, timeoutMs);

    function send(command, args = [], timeout = 180_000) {
      const id = randomUUID();
      const line = [command, id, ...args].join(' ') + '\n';
      return new Promise((resolveCommand, rejectCommand) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          rejectCommand(new Error(`${command} timed out after ${timeout}ms`));
        }, timeout);
        pending.set(id, { resolveCommand, rejectCommand, timer, command });
        child.stdin.write(line);
      });
    }

    function handlePayload(payload) {
      if (payload.type === 'ready') {
        console.error(`[ready] ${JSON.stringify(payload)}`);
        payload.ok ? readyResolve(payload) : readyReject(new Error(payload.message || 'session not ready'));
        return;
      }

      if (payload.type === 'download') {
        if (payload.event === 'progress') {
          console.error(`[progress] ${payload.sent}/${payload.total}`);
        } else {
          console.error(`[download-event] ${JSON.stringify(payload)}`);
        }
        return;
      }

      if (payload.type === 'response') {
        const slot = pending.get(payload.requestId);
        if (!slot) {
          console.error(`[orphan-response] ${JSON.stringify(payload)}`);
          return;
        }
        clearTimeout(slot.timer);
        pending.delete(payload.requestId);
        console.error(`[response:${slot.command}] ok=${payload.ok} message=${payload.message || payload.event || ''}`);
        slot.resolveCommand(payload);
      }
    }

    child.stdout.on('data', (chunk) => {
      stdoutBuffer += chunk.toString('utf8');
      const lines = stdoutBuffer.split('\n');
      stdoutBuffer = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (!trimmed.startsWith('{')) {
          console.error(`[stdout] ${trimmed}`);
          continue;
        }
        handlePayload(JSON.parse(trimmed));
      }
    });

    child.stderr.on('data', (chunk) => {
      stderrBuffer += chunk.toString('utf8');
      process.stderr.write(chunk);
    });

    child.on('close', (code, signal) => {
      clearTimeout(hardTimer);
      console.error(`[session-close] code=${code} signal=${signal}`);
    });

    (async () => {
      try {
        await ready;
        const inventory = await send('inventory', [], 90_000);
        const storage = inventory.devices?.[0]?.storages?.[0];
        if (!storage) {
          throw new Error(`no storage returned: ${JSON.stringify(inventory)}`);
        }
        console.error(`[storage] ${storage.description} id=${storage.id}`);

        const rootList = await send('list', [String(storage.id), String(rootParentId)], 180_000);
        const dcim = rootList.objects?.find((item) => item.kind === 'folder' && item.name === 'DCIM');
        if (!dcim) {
          throw new Error('DCIM folder was not found in the storage root');
        }
        console.error(`[dcim] id=${dcim.id}`);

        const dcimList = await send('list', [String(storage.id), String(dcim.id)], 180_000);
        const queue = [
          {
            path: 'DCIM',
            depth: 0,
            objects: dcimList.objects || []
          }
        ];
        let selected = null;

        while (queue.length && !selected) {
          const current = queue.shift();
          const files = current.objects.filter((item) => item.kind === 'file' && item.size > 0);
          const candidateFiles = minSize > 0 ? files.filter((item) => item.size >= minSize) : files;
          const preferredFile =
            preferExt &&
            candidateFiles.find((item) => item.name.toLowerCase().endsWith(`.${preferExt}`));
          const file = preferredFile || candidateFiles.find((item) => item.size < 10_000_000) || candidateFiles[0];
          if (file) {
            selected = { file, path: current.path };
            break;
          }

          if (current.depth >= 3) {
            continue;
          }

          const folders = current.objects
            .filter((item) => item.kind === 'folder')
            .sort((left, right) => {
              const leftCamera = /camera/i.test(left.name) ? 0 : 1;
              const rightCamera = /camera/i.test(right.name) ? 0 : 1;
              return leftCamera - rightCamera || left.name.localeCompare(right.name);
            });

          for (const folder of folders) {
            const childPath = `${current.path}/${folder.name}`;
            console.error(`[scan-folder] ${childPath}`);
            const childList = await send('list', [String(storage.id), String(folder.id)], 180_000);
            queue.push({
              path: childPath,
              depth: current.depth + 1,
              objects: childList.objects || []
            });
          }
        }

        if (!selected) {
          throw new Error(
            minSize > 0 ? `no DCIM file found at or above --min-size=${minSize}` : 'no file found in DCIM'
          );
        }

        const { file, path } = selected;

        const destination = join(destinationDir, `session-smoke-${Date.now()}-${file.name.replace(/[/:]/g, '_')}`);
        console.error(`[download] ${path}/${file.name} id=${file.id} size=${file.size} -> ${destination}`);
        const downloaded = await send('download', [String(file.id), destination], 240_000);
        const stat = statSync(destination);
        console.error(`[file] copied ${stat.size} bytes`);
        child.stdin.write('quit\n');
        setTimeout(() => child.kill('SIGTERM'), 500);
        if (!downloaded.ok || stat.size < 1) {
          throw new Error('download response or copied file was invalid');
        }
        resolvePromise({ destination, bytes: stat.size });
      } catch (error) {
        child.kill('SIGTERM');
        const suffix = stderrBuffer.trim() ? `\n${stderrBuffer.trim()}` : '';
        rejectPromise(new Error(`${error instanceof Error ? error.message : String(error)}${suffix}`));
      }
    })();
  });
}

try {
  await waitForFreshAddress();
  const result = await runSessionSmoke();
  console.error(`[success] ${result.destination} (${result.bytes} bytes)`);
} catch (error) {
  console.error(`[failed] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
