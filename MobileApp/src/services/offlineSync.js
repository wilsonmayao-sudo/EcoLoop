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

export async function enqueueMutation(mutation) {
  const queue = await readQueue();
  const payload = {
    ...mutation,
    localId: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    createdAt: new Date().toISOString(),
  };
  queue.push(payload);
  await writeQueue(queue);
}

export async function flushOfflineQueue(executeMutation) {
  const state = await NetInfo.fetch();
  if (!state.isConnected) return;

  const queue = await readQueue();
  if (queue.length === 0) return;

  const remaining = [];
  for (const mutation of queue) {
    try {
      await executeMutation(mutation);
    } catch (error) {
      remaining.push(mutation);
      console.warn("Offline sync retry kept in queue:", error?.message ?? error);
    }
  }
  await writeQueue(remaining);
}

export function subscribeConnectivity(executeMutation) {
  return NetInfo.addEventListener(async (state) => {
    if (state.isConnected) {
      await flushOfflineQueue(executeMutation);
    }
  });
}

