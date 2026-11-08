export function requestReleaseWorker<T>(worker: ServiceWorker, message: object, timeout = 120000): Promise<T> {
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => { channel.port1.close(); reject(new Error('Update preparation timed out')); }, timeout);
    channel.port1.onmessage = event => {
      clearTimeout(timer); channel.port1.close();
      if (event.data?.protocol !== 1 || event.data?.error) reject(new Error(event.data?.error || 'Unsupported update worker'));
      else resolve(event.data as T);
    };
    try { worker.postMessage(message, [channel.port2]); }
    catch (error) { clearTimeout(timer); channel.port1.close(); reject(error); }
  });
}

export async function activeReleaseWorker(registration: ServiceWorkerRegistration): Promise<ServiceWorker> {
  const waiting = registration.waiting;
  if (waiting) await requestReleaseWorker(waiting, { type: 'ACTIVATE_WORKER' }, 4000);
  const worker = waiting ?? registration.active ?? registration.installing;
  if (!worker) throw new Error('Update worker unavailable');
  if (worker.state !== 'activated') await new Promise<void>((resolve, reject) => {
    const done = () => {
      if (worker.state !== 'activated' && worker.state !== 'redundant') return;
      clearTimeout(timer); worker.removeEventListener('statechange', done);
      if (worker.state === 'activated') resolve(); else reject(new Error('Update worker was replaced'));
    };
    const timer = setTimeout(() => { worker.removeEventListener('statechange', done); reject(new Error('Update worker activation timed out')); }, 15000);
    worker.addEventListener('statechange', done); done();
  });
  return worker;
}
