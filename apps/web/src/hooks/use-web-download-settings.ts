import {
	DEFAULT_WEB_DOWNLOAD_SETTINGS,
	type WebDownloadSettings,
} from "../lib/download-format-preferences";
import { useWebSettings } from "./use-web-settings";

export const useWebDownloadSettings = () => {
	const { settings: webSettings, updateSettings: updateWebSettings } =
		useWebSettings();

	const settings: WebDownloadSettings = {
		oneClickDownload:
			webSettings.oneClickDownload ??
			DEFAULT_WEB_DOWNLOAD_SETTINGS.oneClickDownload,
		oneClickDownloadType:
			webSettings.oneClickDownloadType ??
			DEFAULT_WEB_DOWNLOAD_SETTINGS.oneClickDownloadType,
		oneClickQuality:
			webSettings.oneClickQuality ??
			DEFAULT_WEB_DOWNLOAD_SETTINGS.oneClickQuality,
	};

	const updateSettings = (updates: Partial<WebDownloadSettings>) => {
		updateWebSettings(updates);
	};

	return {
		settings,
		updateSettings,
	};
};
