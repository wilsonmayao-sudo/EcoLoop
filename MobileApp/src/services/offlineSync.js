import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo from "@react-native-community/netinfo";

const OFFLINE_QUEUE_KEY = "offline_mutation_queue";

async function readQueue() {
  const raw = await AsyncStorage.getItem(OFFLINE_QUEUE_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function writeQueue(items) {
  await AsyncStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(items));
}

let isFlushing = false;

export async function enqueueMutation(mutation) {
  if (!mutation) return;
  const queue = await readQueue();
  const isDuplicate = queue.some((item) => {
    if (item.type !== mutation.type) return false;
    if (mutation.type === "COMPLETE_DELIVERY") {
      return String(item.deliveryId) === String(mutation.deliveryId);
    }
    return false;
  });
  if (isDuplicate) return;

  const payload = {
    ...mutation,
    localId: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    createdAt: new Date().toISOString(),
  };
  queue.push(payload);
  await writeQueue(queue);
}

export async function flushOfflineQueue(executeMutation) {
  if (isFlushing) return 0;
  const state = await NetInfo.fetch();
  if (!state.isConnected) return 0;

  isFlushing = true;
  let processedCount = 0;
  try {
    const queue = await readQueue();
    if (queue.length === 0) return 0;

    const remaining = [];
    for (const mutation of queue) {
      try {
        await executeMutation(mutation);
        processedCount += 1;
      } catch (error) {
        remaining.push(mutation);
        console.warn("Offline sync retry kept in queue:", error?.message ?? error);
      }
    }
    await writeQueue(remaining);
    return processedCount;
  } finally {
    isFlushing = false;
  }
}

export function subscribeConnectivity(executeMutation, onFlushed) {
  return NetInfo.addEventListener(async (state) => {
    if (state.isConnected) {
      const count = await flushOfflineQueue(executeMutation);
      if (count > 0 && typeof onFlushed === "function") {
        onFlushed();
      }
    }
  });
}

export async function getOfflineQueue() {
  return readQueue();
}

export async function clearOfflineQueue() {
  await writeQueue([]);
}

