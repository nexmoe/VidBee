const notifiedIds = new Set<string>();

/**
 * Ask the browser for notification permission if the user turned the setting on.
 */
export const ensureDownloadNotificationPermission =
	async (): Promise<boolean> => {
		if (typeof window === "undefined" || !("Notification" in window)) {
			return false;
		}
		if (Notification.permission === "granted") {
			return true;
		}
		if (Notification.permission === "denied") {
			return false;
		}
		const permission = await Notification.requestPermission();
		return permission === "granted";
	};

/**
 * Notify once when a download finishes, matching Desktop's completion toast/banner.
 *
 * @param id Download id.
 * @param title Video title.
 * @param enabled Whether the user opted into notifications.
 */
export const notifyDownloadCompleted = (
	id: string,
	title: string,
	enabled: boolean,
): void => {
	if (!enabled || notifiedIds.has(id)) {
		return;
	}
	notifiedIds.add(id);
	if (typeof window === "undefined" || !("Notification" in window)) {
		return;
	}
	if (Notification.permission !== "granted") {
		return;
	}
	try {
		new Notification(title || "VidBee", {
			body: title,
		});
	} catch {
		// Browsers may reject notifications without a service worker.
	}
};
