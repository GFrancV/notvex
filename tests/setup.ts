// A test that lets the renderer recycle's process.kill through would signal a real process on the
// machine running it. Replaced outright, not spied, so restoreAllMocks can't undo it. Signal 0
// only probes whether a pid is alive (the vault lock file check) and kills nothing.
const realKill = process.kill.bind(process)

process.kill = ((pid: number, signal?: string | number): true => {
  if (pid !== process.pid && signal !== 0) {
    throw new Error(`a test tried to send ${String(signal ?? 'SIGTERM')} to pid ${pid}`)
  }
  return realKill(pid, signal)
}) as typeof process.kill
