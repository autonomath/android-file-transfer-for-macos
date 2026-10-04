#!/usr/bin/env node

import { spawn } from 'node:child_process';

const [secondsArg, command, ...args] = process.argv.slice(2);
const seconds = Number(secondsArg);
if (!Number.isInteger(seconds) || seconds < 1 || !command) {
  console.error('Usage: run-release-command.mjs TIMEOUT_SECONDS COMMAND [ARGS...]');
  process.exit(2);
}

const child = spawn(command, args, { stdio: 'inherit', detached: true });
let timedOut = false;
let spawnFailed = false;
let killTimer;

function stop(signal) {
  if (!child.pid) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    child.kill(signal);
  }
}

const timeoutTimer = setTimeout(() => {
  timedOut = true;
  console.error(`Release smoke command timed out after ${seconds}s: ${command}`);
  stop('SIGTERM');
  killTimer = setTimeout(() => stop('SIGKILL'), 2000);
}, seconds * 1000);

child.on('error', (error) => {
  clearTimeout(timeoutTimer);
  if (killTimer) clearTimeout(killTimer);
  spawnFailed = true;
  console.error(error);
  process.exitCode = 127;
});

child.on('close', (code, signal) => {
  clearTimeout(timeoutTimer);
  if (killTimer) clearTimeout(killTimer);
  process.exitCode = spawnFailed ? 127 : timedOut ? 124 : code ?? (signal ? 128 : 1);
});
