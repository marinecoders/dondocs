import { useState } from 'react';

// Unit tests do not install real service workers. Update tests replace this
// module with a controlled registration and drive controllerchange explicitly.
export function useRegisterSW() {
  return {
    needRefresh: useState(false),
    offlineReady: useState(false),
    updateServiceWorker: async () => {},
  };
}
