import type { DownloadRuntimeSettings } from "@vidbee/downloader-core";
import { readWebSettings } from "./web-settings";

export const readOrpcDownloadSettings = (): DownloadRuntimeSettings => {
	const settings = readWebSettings();
	return {
		downloadPath: settings.downloadPath,
		browserForCookies: settings.browserForCookies,
		cookiesPath: settings.cookiesPath,
		proxy: settings.proxy,
		configPath: settings.configPath,
		embedSubs: settings.embedSubs,
		embedThumbnail: settings.embedThumbnail,
		embedMetadata: settings.embedMetadata,
		embedChapters: settings.embedChapters,
	};
};
