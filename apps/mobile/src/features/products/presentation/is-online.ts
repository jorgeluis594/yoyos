import * as Network from "expo-network";

/** Whether a request can leave the device. When it cannot, nothing was sent, so a failure is «no salió», never in doubt. */
export async function isOnline() {
  const state = await Network.getNetworkStateAsync().catch(() => null);
  return state?.isConnected !== false && state?.isInternetReachable !== false;
}
