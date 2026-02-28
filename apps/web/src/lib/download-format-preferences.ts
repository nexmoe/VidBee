import type { DownloadType } from "@vidbee/downloader-core";
import {
	buildAudioFormatPreference as buildSharedAudioFormatPreference,
	buildVideoFormatPreference as buildSharedVideoFormatPreference,
	type OneClickQualityPreset,
} from "@vidbee/downloader-core/format-preferences";

export type { OneClickQualityPreset };

export interface WebDownloadSettings {
	oneClickDownload: boolean;
	oneClickDownloadType: DownloadType;
	oneClickQuality: OneClickQualityPreset;
}

export const DEFAULT_WEB_DOWNLOAD_SETTINGS: WebDownloadSettings = {
	oneClickDownload: false,
	oneClickDownloadType: "video",
	oneClickQuality: "best",
};

export const buildVideoFormatPreference = (
	settings: WebDownloadSettings,
): string =>
	buildSharedVideoFormatPreference({
		oneClickQuality: settings.oneClickQuality,
	});

export const buildAudioFormatPreference = (
	settings: WebDownloadSettings,
): string =>
	buildSharedAudioFormatPreference({
		oneClickQuality: settings.oneClickQuality,
	});
