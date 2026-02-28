import type { DownloadType } from "@vidbee/downloader-core";
import {
	defaultLanguageCode,
	type LanguageCode,
	normalizeLanguageCode,
} from "@vidbee/i18n/languages";

export type OneClickQualityPreset =
	| "best"
	| "good"
	| "normal"
	| "bad"
	| "worst";

export type ThemeValue = "light" | "dark" | "system";

export interface WebAppSettings {
	downloadPath: string;
	maxConcurrentDownloads: number;
	browserForCookies: string;
	cookiesPath: string;
	proxy: string;
	configPath: string;
	betaProgram: boolean;
	language: LanguageCode;
	theme: ThemeValue;
	oneClickDownload: boolean;
	oneClickDownloadType: DownloadType;
	oneClickQuality: OneClickQualityPreset;
	closeToTray: boolean;
	autoUpdate: boolean;
	subscriptionOnlyLatestDefault: boolean;
	enableAnalytics: boolean;
	embedSubs: boolean;
	embedThumbnail: boolean;
	embedMetadata: boolean;
	embedChapters: boolean;
	shareWatermark: boolean;
}

export const WEB_SETTINGS_STORAGE_KEY = "vidbee.web.settings";

export const defaultWebSettings: WebAppSettings = {
	downloadPath: "",
	maxConcurrentDownloads: 5,
	browserForCookies: "none",
	cookiesPath: "",
	proxy: "",
	configPath: "",
	betaProgram: false,
	language: defaultLanguageCode,
	theme: "system",
	oneClickDownload: false,
	oneClickDownloadType: "video",
	oneClickQuality: "best",
	closeToTray: true,
	autoUpdate: true,
	subscriptionOnlyLatestDefault: true,
	enableAnalytics: true,
	embedSubs: true,
	embedThumbnail: false,
	embedMetadata: true,
	embedChapters: true,
	shareWatermark: false,
};

const toThemeValue = (value: unknown): ThemeValue => {
	if (value === "dark" || value === "light" || value === "system") {
		return value;
	}
	return defaultWebSettings.theme;
};

const toOneClickQuality = (value: unknown): OneClickQualityPreset => {
	if (
		value === "best" ||
		value === "good" ||
		value === "normal" ||
		value === "bad" ||
		value === "worst"
	) {
		return value;
	}
	return defaultWebSettings.oneClickQuality;
};

const toDownloadType = (value: unknown): DownloadType => {
	if (value === "audio" || value === "video") {
		return value;
	}
	return defaultWebSettings.oneClickDownloadType;
};

const toBoolean = (value: unknown, fallback: boolean): boolean =>
	typeof value === "boolean" ? value : fallback;

const toNumber = (value: unknown, fallback: number): number =>
	typeof value === "number" && Number.isFinite(value) ? value : fallback;

const toStringValue = (value: unknown, fallback = ""): string =>
	typeof value === "string" ? value : fallback;

const parseSettings = (raw: string | null): WebAppSettings => {
	if (!raw) {
		return defaultWebSettings;
	}

	try {
		const parsed = JSON.parse(raw) as Partial<WebAppSettings>;
		return {
			...defaultWebSettings,
			downloadPath: toStringValue(parsed.downloadPath),
			maxConcurrentDownloads: toNumber(
				parsed.maxConcurrentDownloads,
				defaultWebSettings.maxConcurrentDownloads,
			),
			browserForCookies: toStringValue(
				parsed.browserForCookies,
				defaultWebSettings.browserForCookies,
			),
			cookiesPath: toStringValue(parsed.cookiesPath),
			proxy: toStringValue(parsed.proxy),
			configPath: toStringValue(parsed.configPath),
			betaProgram: toBoolean(
				parsed.betaProgram,
				defaultWebSettings.betaProgram,
			),
			language: normalizeLanguageCode(parsed.language),
			theme: toThemeValue(parsed.theme),
			oneClickDownload: toBoolean(
				parsed.oneClickDownload,
				defaultWebSettings.oneClickDownload,
			),
			oneClickDownloadType: toDownloadType(parsed.oneClickDownloadType),
			oneClickQuality: toOneClickQuality(parsed.oneClickQuality),
			closeToTray: toBoolean(
				parsed.closeToTray,
				defaultWebSettings.closeToTray,
			),
			autoUpdate: toBoolean(parsed.autoUpdate, defaultWebSettings.autoUpdate),
			subscriptionOnlyLatestDefault: toBoolean(
				parsed.subscriptionOnlyLatestDefault,
				defaultWebSettings.subscriptionOnlyLatestDefault,
			),
			enableAnalytics: toBoolean(
				parsed.enableAnalytics,
				defaultWebSettings.enableAnalytics,
			),
			embedSubs: toBoolean(parsed.embedSubs, defaultWebSettings.embedSubs),
			embedThumbnail: toBoolean(
				parsed.embedThumbnail,
				defaultWebSettings.embedThumbnail,
			),
			embedMetadata: toBoolean(
				parsed.embedMetadata,
				defaultWebSettings.embedMetadata,
			),
			embedChapters: toBoolean(
				parsed.embedChapters,
				defaultWebSettings.embedChapters,
			),
			shareWatermark: toBoolean(
				parsed.shareWatermark,
				defaultWebSettings.shareWatermark,
			),
		};
	} catch {
		return defaultWebSettings;
	}
};

export const readWebSettings = (): WebAppSettings => {
	if (typeof window === "undefined") {
		return defaultWebSettings;
	}

	return parseSettings(window.localStorage.getItem(WEB_SETTINGS_STORAGE_KEY));
};

export const writeWebSettings = (settings: WebAppSettings): void => {
	if (typeof window === "undefined") {
		return;
	}

	window.localStorage.setItem(
		WEB_SETTINGS_STORAGE_KEY,
		JSON.stringify(settings),
	);
};

export const applyThemeToDocument = (theme: ThemeValue): void => {
	if (typeof window === "undefined") {
		return;
	}

	const root = window.document.documentElement;
	const shouldUseDark =
		theme === "dark" ||
		(theme === "system" &&
			window.matchMedia &&
			window.matchMedia("(prefers-color-scheme: dark)").matches);

	root.classList.toggle("dark", shouldUseDark);
};
