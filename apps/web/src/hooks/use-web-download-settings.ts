import {
	DEFAULT_WEB_DOWNLOAD_SETTINGS,
	type WebDownloadSettings,
} from "../lib/download-format-preferences";
import { useWebSettings } from "./use-web-settings";

export const useWebDownloadSettings = () => {
	const { settings: webSettings, updateSettings: updateWebSettings } =
		useWebSettings();

	const settings: WebDownloadSettings & {
		preferredAudioLanguage: string;
		rememberLastAudioLanguage: boolean;
	} = {
		oneClickDownload:
			webSettings.oneClickDownload ??
			DEFAULT_WEB_DOWNLOAD_SETTINGS.oneClickDownload,
		oneClickDownloadType:
			webSettings.oneClickDownloadType ??
			DEFAULT_WEB_DOWNLOAD_SETTINGS.oneClickDownloadType,
		oneClickQuality:
			webSettings.oneClickQuality ??
			DEFAULT_WEB_DOWNLOAD_SETTINGS.oneClickQuality,
		oneClickContainer:
			webSettings.oneClickContainer ??
			DEFAULT_WEB_DOWNLOAD_SETTINGS.oneClickContainer,
		preferredAudioLanguage: webSettings.preferredAudioLanguage,
		rememberLastAudioLanguage: webSettings.rememberLastAudioLanguage,
	};

	const updateSettings = (
		updates: Partial<WebDownloadSettings> & { preferredAudioLanguage?: string },
	) => {
		updateWebSettings(updates);
	};

	return {
		settings,
		updateSettings,
	};
};
