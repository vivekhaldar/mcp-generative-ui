// ABOUTME: Stderr logging helper that keeps stdout clean for pipe protocol.
// ABOUTME: All modules use this instead of console.log to avoid corrupting pipe output.

export function log(msg: string): void {
  process.stderr.write(msg + "\n");
}
