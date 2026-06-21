export type NotificationPayload = {
  title: string;
  content: string;
};

/**
 * Owner notification stub.
 * Wire this up to email / Slack / etc. if you need push notifications.
 * For now it logs to the server console and returns false (no delivery).
 */
export async function notifyOwner(payload: NotificationPayload): Promise<boolean> {
  console.log("[Notification] Owner notification (not delivered):", payload.title);
  return false;
}
