export type NotificationPayload = {
  title: string;
  content: string;
};

export async function notifyOwner(payload: NotificationPayload): Promise<boolean> {
  console.log("[Notification] Owner notification (not delivered):", payload.title);
  return false;
}
