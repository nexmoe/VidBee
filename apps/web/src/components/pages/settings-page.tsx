import {
	buildBrowserCookiesSetting,
	parseBrowserCookiesSetting,
} from "@vidbee/downloader-core/browser-cookies-setting";
import {
	type LanguageCode,
	languageList,
	normalizeLanguageCode,
} from "@vidbee/i18n/languages";
import { Button } from "@vidbee/ui/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@vidbee/ui/components/ui/dialog";
import { Input } from "@vidbee/ui/components/ui/input";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemSeparator,
	ItemTitle,
} from "@vidbee/ui/components/ui/item";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@vidbee/ui/components/ui/select";
import { Switch } from "@vidbee/ui/components/ui/switch";
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "@vidbee/ui/components/ui/tabs";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@vidbee/ui/components/ui/tooltip";
import { AlertTriangle, Folder, RefreshCw } from "lucide-react";
import { type ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useWebSettings } from "../../hooks/use-web-settings";
import type { OneClickQualityPreset } from "../../lib/download-format-preferences";
import { orpcClient } from "../../lib/orpc-client";
import type { ThemeValue, WebAppSettings } from "../../lib/web-settings";
import { AppShell } from "../layout/app-shell";

type SettingsTab = "advanced" | "cookies" | "general";

type BrowserProfileValidationReason =
	| "browserUnsupported"
	| "empty"
	| "pathNotFound"
	| "profileNotFound";

interface BrowserProfileValidation {
	valid: boolean;
	reason?: BrowserProfileValidationReason;
}

interface ServerDirectoryEntry {
	name: string;
	path: string;
}

const WINDOWS_PLATFORM = "win32";
const MAC_PLATFORM = "darwin";
const MAX_SETTINGS_UPLOAD_BYTES = 1_000_000;

const parsePlatform = (userAgent: string): string => {
	const normalizedUserAgent = userAgent.toLowerCase();
	if (normalizedUserAgent.includes("mac os")) {
		return MAC_PLATFORM;
	}
	if (normalizedUserAgent.includes("windows")) {
		return WINDOWS_PLATFORM;
	}
	if (normalizedUserAgent.includes("linux")) {
		return "linux";
	}
	return "web";
};

const ABSOLUTE_WINDOWS_PATH_REGEX = /^[A-Za-z]:\\/;

const validateBrowserProfile = (
	browser: string,
	profile: string,
	platform: string,
): BrowserProfileValidation => {
	const trimmedProfile = profile.trim();
	if (!trimmedProfile) {
		return { valid: false, reason: "empty" };
	}

	if (browser === "safari" && platform !== MAC_PLATFORM) {
		return { valid: false, reason: "browserUnsupported" };
	}

	const hasPathSeparator =
		trimmedProfile.includes("/") || trimmedProfile.includes("\\");
	if (hasPathSeparator) {
		const isAbsolutePath =
			trimmedProfile.startsWith("/") ||
			ABSOLUTE_WINDOWS_PATH_REGEX.test(trimmedProfile);
		if (!isAbsolutePath) {
			return { valid: false, reason: "pathNotFound" };
		}
	}

	if (trimmedProfile.length < 2) {
		return { valid: false, reason: "profileNotFound" };
	}

	return { valid: true };
};

const toSelectString = (value: number): string => value.toString();

const getBrowserProfileWarningMessage = (
	reason: BrowserProfileValidationReason | undefined,
	t: (key: string) => string,
): string => {
	switch (reason) {
		case "pathNotFound":
			return t("settings.browserForCookiesProfileInvalidPath");
		case "profileNotFound":
			return t("settings.browserForCookiesProfileInvalidProfile");
		case "browserUnsupported":
			return t("settings.browserForCookiesProfileInvalidUnsupported");
		case "empty":
			return t("settings.browserForCookiesProfileInvalidEmpty");
		default:
			return t("settings.browserForCookiesProfileInvalid");
	}
};

const updateSingleSetting = <K extends keyof WebAppSettings>(
	key: K,
	value: WebAppSettings[K],
	updateSettings: (updates: Partial<WebAppSettings>) => void,
) => {
	updateSettings({ [key]: value } as Pick<WebAppSettings, K>);
};

export const SettingsPage = () => {
	const { t } = useTranslation();
	const { settings, updateSettings } = useWebSettings();
	const [platform, setPlatform] = useState<string>("web");
	const [activeTab, setActiveTab] = useState<SettingsTab>("general");
	const [downloadPathDialogOpen, setDownloadPathDialogOpen] = useState(false);
	const [serverPathLoading, setServerPathLoading] = useState(false);
	const [serverPathError, setServerPathError] = useState<string | null>(null);
	const [serverCurrentPath, setServerCurrentPath] = useState("");
	const [serverPathInput, setServerPathInput] = useState("");
	const [serverParentPath, setServerParentPath] = useState<string | null>(null);
	const [serverDirectories, setServerDirectories] = useState<
		ServerDirectoryEntry[]
	>([]);
	const configFileInputRef = useRef<HTMLInputElement>(null);
	const cookiesFileInputRef = useRef<HTMLInputElement>(null);
	const [configFileUploading, setConfigFileUploading] = useState(false);
	const [cookiesFileUploading, setCookiesFileUploading] = useState(false);

	const parsedBrowserCookies = parseBrowserCookiesSetting(
		settings.browserForCookies,
	);
	const browserForCookiesValue = parsedBrowserCookies.browser;
	const browserCookiesProfileValue = parsedBrowserCookies.profile;

	const normalizedBrowserCookiesSetting = buildBrowserCookiesSetting(
		browserForCookiesValue,
		browserCookiesProfileValue,
	);

	const browserProfileValidation = useMemo(
		() =>
			validateBrowserProfile(
				browserForCookiesValue,
				browserCookiesProfileValue,
				platform,
			),
		[browserForCookiesValue, browserCookiesProfileValue, platform],
	);

	const hasBrowserProfileValue = browserCookiesProfileValue.trim().length > 0;
	const showBrowserProfileWarning =
		hasBrowserProfileValue &&
		!browserProfileValidation.valid &&
		browserProfileValidation.reason !== "empty";

	useEffect(() => {
		if (typeof window === "undefined") {
			return;
		}

		setPlatform(parsePlatform(window.navigator.userAgent));
	}, []);

	useEffect(() => {
		if (typeof window === "undefined") {
			return;
		}

		const searchParams = new URLSearchParams(window.location.search);
		const tab = searchParams.get("tab");
		if (tab === "general" || tab === "advanced" || tab === "cookies") {
			setActiveTab(tab);
		}
	}, []);

	useEffect(() => {
		if (settings.browserForCookies === normalizedBrowserCookiesSetting) {
			return;
		}

		updateSingleSetting(
			"browserForCookies",
			normalizedBrowserCookiesSetting,
			updateSettings,
		);
	}, [
		normalizedBrowserCookiesSetting,
		settings.browserForCookies,
		updateSettings,
	]);

	const languageOptions = languageList;
	const activeLanguageCode = normalizeLanguageCode(settings.language);
	const currentLanguage =
		languageOptions.find((option) => option.value === activeLanguageCode) ??
		languageOptions[0];

	const handleThemeChange = (value: ThemeValue) => {
		if (settings.theme === value) {
			return;
		}
		updateSingleSetting("theme", value, updateSettings);
	};

	const handleLanguageChange = (value: LanguageCode) => {
		if (settings.language === value) {
			return;
		}
		updateSingleSetting("language", value, updateSettings);
	};

	const loadServerDirectories = async (targetPath?: string) => {
		setServerPathLoading(true);
		setServerPathError(null);

		try {
			const response = await orpcClient.files.listDirectories({
				path: targetPath?.trim() || undefined,
			});
			setServerCurrentPath(response.currentPath);
			setServerPathInput(response.currentPath);
			setServerParentPath(response.parentPath);
			setServerDirectories(response.directories);
		} catch {
			setServerPathError(t("errors.networkError"));
		} finally {
			setServerPathLoading(false);
		}
	};

	const handleOpenDownloadPathDialog = () => {
		setDownloadPathDialogOpen(true);
		setServerPathInput(settings.downloadPath);
		void loadServerDirectories(settings.downloadPath);
	};

	const handleNavigateServerDirectory = (targetPath: string) => {
		void loadServerDirectories(targetPath);
	};

	const handleSubmitServerPathInput = () => {
		const targetPath = serverPathInput.trim();
		if (!targetPath) {
			return;
		}

		handleNavigateServerDirectory(targetPath);
	};

	const handleSelectCurrentServerPath = () => {
		const selectedPath = serverPathInput.trim() || serverCurrentPath.trim();
		if (!selectedPath) {
			return;
		}

		updateSingleSetting("downloadPath", selectedPath, updateSettings);
		setDownloadPathDialogOpen(false);
	};

	const uploadSelectedSettingsFile = async (
		kind: "config" | "cookies",
		file: File,
	): Promise<string> => {
		if (file.size > MAX_SETTINGS_UPLOAD_BYTES) {
			throw new Error(t("settings.fileSelectError"));
		}

		const content = await file.text();
		const response = await orpcClient.files.uploadSettingsFile({
			kind,
			fileName: file.name,
			content,
		});
		return response.path;
	};

	const handleSelectConfigFile = () => {
		configFileInputRef.current?.click();
	};

	const handleSelectCookiesFile = () => {
		cookiesFileInputRef.current?.click();
	};

	const handleConfigFileInputChange = (
		event: ChangeEvent<HTMLInputElement>,
	) => {
		const selectedFile = event.target.files?.[0];
		event.target.value = "";
		if (!selectedFile) {
			return;
		}

		setConfigFileUploading(true);
		void uploadSelectedSettingsFile("config", selectedFile)
			.then((serverPath) => {
				updateSingleSetting("configPath", serverPath, updateSettings);
			})
			.catch((error: unknown) => {
				const message =
					error instanceof Error && error.message.trim().length > 0
						? error.message
						: t("settings.fileSelectError");
				toast.error(message);
			})
			.finally(() => {
				setConfigFileUploading(false);
			});
	};

	const handleCookiesFileInputChange = (
		event: ChangeEvent<HTMLInputElement>,
	) => {
		const selectedFile = event.target.files?.[0];
		event.target.value = "";
		if (!selectedFile) {
			return;
		}

		setCookiesFileUploading(true);
		void uploadSelectedSettingsFile("cookies", selectedFile)
			.then((serverPath) => {
				updateSingleSetting("cookiesPath", serverPath, updateSettings);
			})
			.catch((error: unknown) => {
				const message =
					error instanceof Error && error.message.trim().length > 0
						? error.message
						: t("settings.fileSelectError");
				toast.error(message);
			})
			.finally(() => {
				setCookiesFileUploading(false);
			});
	};

	const handleOpenCookiesGuide = () => {
		if (typeof window === "undefined") {
			return;
		}
		window.open(
			"https://docs.vidbee.org/cookies",
			"_blank",
			"noopener,noreferrer",
		);
	};

	return (
		<AppShell page="settings">
			<div className="h-full bg-background">
				<div className="container mx-auto max-w-4xl space-y-6 p-6">
					<div className="space-y-2">
						<h1 className="font-bold text-3xl tracking-tight">
							{t("settings.title")}
						</h1>
						<p className="text-muted-foreground">{t("settings.description")}</p>
					</div>

					<Tabs
						onValueChange={(value) => setActiveTab(value as SettingsTab)}
						value={activeTab}
					>
						<TabsList className="grid w-full grid-cols-3">
							<TabsTrigger value="general">{t("settings.general")}</TabsTrigger>
							<TabsTrigger value="cookies">
								{t("settings.cookiesTab")}
							</TabsTrigger>
							<TabsTrigger value="advanced">
								{t("settings.advanced")}
							</TabsTrigger>
						</TabsList>

						<TabsContent className="mt-2 space-y-4" value="general">
							<ItemGroup>
								<Item variant="muted">
									<ItemContent>
										<ItemTitle>{t("settings.downloadPath")}</ItemTitle>
										<ItemDescription>
											{t("settings.downloadPathDescription")}
										</ItemDescription>
									</ItemContent>
									<ItemActions>
										<div className="flex w-full max-w-md gap-2">
											<Input
												className="flex-1"
												readOnly
												value={settings.downloadPath}
											/>
											<Button onClick={handleOpenDownloadPathDialog}>
												{t("settings.selectPath")}
											</Button>
										</div>
									</ItemActions>
								</Item>

								<ItemSeparator />

								<Item variant="muted">
									<ItemContent>
										<ItemTitle>{t("settings.theme")}</ItemTitle>
										<ItemDescription>
											{t("settings.themeDescription")}
										</ItemDescription>
									</ItemContent>
									<ItemActions>
										<Select
											onValueChange={(value) =>
												handleThemeChange(value as ThemeValue)
											}
											value={settings.theme}
										>
											<SelectTrigger className="w-32">
												<SelectValue />
											</SelectTrigger>
											<SelectContent>
												<SelectItem value="light">
													{t("settings.light")}
												</SelectItem>
												<SelectItem value="dark">
													{t("settings.dark")}
												</SelectItem>
												<SelectItem value="system">
													{t("settings.system")}
												</SelectItem>
											</SelectContent>
										</Select>
									</ItemActions>
								</Item>

								<ItemSeparator />

								<Item variant="muted">
									<ItemContent>
										<ItemTitle>{t("settings.language")}</ItemTitle>
										<ItemDescription>
											{t("settings.languageDescription")}
										</ItemDescription>
									</ItemContent>
									<ItemActions>
										<Select
											onValueChange={(value) =>
												handleLanguageChange(value as LanguageCode)
											}
											value={currentLanguage.value}
										>
											<SelectTrigger className="w-52">
												<SelectValue placeholder={currentLanguage.name}>
													<div className="flex items-center gap-2">
														<span
															aria-hidden="true"
															className={`${currentLanguage.flag} rounded-xs text-base`}
														/>
														<span lang={currentLanguage.hreflang}>
															{currentLanguage.name}
														</span>
													</div>
												</SelectValue>
											</SelectTrigger>
											<SelectContent>
												{languageOptions.map((option) => (
													<SelectItem
														className={
															option.value === currentLanguage.value
																? "bg-muted font-semibold"
																: undefined
														}
														key={option.value}
														value={option.value}
													>
														<div className="flex items-center gap-2">
															<span
																aria-hidden="true"
																className={`${option.flag} rounded-xs text-base`}
															/>
															<span lang={option.hreflang}>{option.name}</span>
														</div>
													</SelectItem>
												))}
											</SelectContent>
										</Select>
									</ItemActions>
								</Item>
							</ItemGroup>

							<ItemGroup>
								<Item variant="muted">
									<ItemContent>
										<ItemTitle>{t("settings.oneClickDownload")}</ItemTitle>
										<ItemDescription>
											{t("settings.oneClickDownloadDescription")}
										</ItemDescription>
									</ItemContent>
									<ItemActions>
										<Switch
											checked={settings.oneClickDownload}
											onCheckedChange={(value) =>
												updateSingleSetting(
													"oneClickDownload",
													value,
													updateSettings,
												)
											}
										/>
									</ItemActions>
								</Item>

								{settings.oneClickDownload && (
									<>
										<ItemSeparator />
										<Item variant="muted">
											<ItemContent>
												<ItemTitle>
													{t("settings.oneClickDownloadType")}
												</ItemTitle>
												<ItemDescription>
													{t("settings.oneClickDownloadTypeDescription")}
												</ItemDescription>
											</ItemContent>
											<ItemActions>
												<Select
													onValueChange={(value) =>
														updateSingleSetting(
															"oneClickDownloadType",
															value as "audio" | "video",
															updateSettings,
														)
													}
													value={settings.oneClickDownloadType}
												>
													<SelectTrigger className="w-32">
														<SelectValue />
													</SelectTrigger>
													<SelectContent>
														<SelectItem value="video">
															{t("download.video")}
														</SelectItem>
														<SelectItem value="audio">
															{t("download.audio")}
														</SelectItem>
													</SelectContent>
												</Select>
											</ItemActions>
										</Item>

										<ItemSeparator />
										<Item variant="muted">
											<ItemContent>
												<ItemTitle>{t("settings.oneClickQuality")}</ItemTitle>
												<ItemDescription>
													{t("settings.oneClickQualityDescription")}
												</ItemDescription>
											</ItemContent>
											<ItemActions>
												<Select
													onValueChange={(value) =>
														updateSingleSetting(
															"oneClickQuality",
															value as OneClickQualityPreset,
															updateSettings,
														)
													}
													value={settings.oneClickQuality}
												>
													<SelectTrigger className="w-40">
														<SelectValue />
													</SelectTrigger>
													<SelectContent>
														<SelectItem value="best">
															{t("settings.oneClickQualityOptions.best")}
														</SelectItem>
														<SelectItem value="good">
															{t("settings.oneClickQualityOptions.good")}
														</SelectItem>
														<SelectItem value="normal">
															{t("settings.oneClickQualityOptions.normal")}
														</SelectItem>
														<SelectItem value="bad">
															{t("settings.oneClickQualityOptions.bad")}
														</SelectItem>
														<SelectItem value="worst">
															{t("settings.oneClickQualityOptions.worst")}
														</SelectItem>
													</SelectContent>
												</Select>
											</ItemActions>
										</Item>
									</>
								)}
							</ItemGroup>
						</TabsContent>

						<TabsContent className="mt-2 space-y-4" value="advanced">
							<ItemGroup>
								<Item variant="muted">
									<ItemContent>
										<ItemTitle>{t("settings.embedSubs")}</ItemTitle>
										<ItemDescription>
											{t("settings.embedSubsDescription")}
										</ItemDescription>
									</ItemContent>
									<ItemActions>
										<Switch
											checked={settings.embedSubs}
											onCheckedChange={(value) =>
												updateSingleSetting("embedSubs", value, updateSettings)
											}
										/>
									</ItemActions>
								</Item>

								<ItemSeparator />

								<Item variant="muted">
									<ItemContent>
										<ItemTitle>{t("settings.embedThumbnail")}</ItemTitle>
										<ItemDescription>
											{t("settings.embedThumbnailDescription")}
										</ItemDescription>
									</ItemContent>
									<ItemActions>
										<Switch
											checked={settings.embedThumbnail}
											onCheckedChange={(value) =>
												updateSingleSetting(
													"embedThumbnail",
													value,
													updateSettings,
												)
											}
										/>
									</ItemActions>
								</Item>

								<ItemSeparator />

								<Item variant="muted">
									<ItemContent>
										<ItemTitle>{t("settings.embedMetadata")}</ItemTitle>
										<ItemDescription>
											{t("settings.embedMetadataDescription")}
										</ItemDescription>
									</ItemContent>
									<ItemActions>
										<Switch
											checked={settings.embedMetadata}
											onCheckedChange={(value) =>
												updateSingleSetting(
													"embedMetadata",
													value,
													updateSettings,
												)
											}
										/>
									</ItemActions>
								</Item>

								<ItemSeparator />

								<Item variant="muted">
									<ItemContent>
										<ItemTitle>{t("settings.embedChapters")}</ItemTitle>
										<ItemDescription>
											{t("settings.embedChaptersDescription")}
										</ItemDescription>
									</ItemContent>
									<ItemActions>
										<Switch
											checked={settings.embedChapters}
											onCheckedChange={(value) =>
												updateSingleSetting(
													"embedChapters",
													value,
													updateSettings,
												)
											}
										/>
									</ItemActions>
								</Item>

								<ItemSeparator />

								<Item variant="muted">
									<ItemContent>
										<ItemTitle>{t("settings.shareWatermark")}</ItemTitle>
										<ItemDescription>
											{t("settings.shareWatermarkDescription")}
										</ItemDescription>
									</ItemContent>
									<ItemActions>
										<Switch
											checked={settings.shareWatermark}
											onCheckedChange={(value) =>
												updateSingleSetting(
													"shareWatermark",
													value,
													updateSettings,
												)
											}
										/>
									</ItemActions>
								</Item>
							</ItemGroup>

							<ItemGroup>
								<Item variant="muted">
									<ItemContent>
										<ItemTitle>
											{t("settings.maxConcurrentDownloads")}
										</ItemTitle>
										<ItemDescription>
											{t("settings.maxConcurrentDownloadsDescription")}
										</ItemDescription>
									</ItemContent>
									<ItemActions>
										<Select
											onValueChange={(value) =>
												updateSingleSetting(
													"maxConcurrentDownloads",
													Number(value),
													updateSettings,
												)
											}
											value={toSelectString(settings.maxConcurrentDownloads)}
										>
											<SelectTrigger className="w-20">
												<SelectValue />
											</SelectTrigger>
											<SelectContent>
												{[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((num) => (
													<SelectItem key={num} value={num.toString()}>
														{num}
													</SelectItem>
												))}
											</SelectContent>
										</Select>
									</ItemActions>
								</Item>

								<ItemSeparator />

								<Item variant="muted">
									<ItemContent>
										<ItemTitle>{t("settings.proxy")}</ItemTitle>
										<ItemDescription>
											{t("settings.proxyDescription")}
										</ItemDescription>
									</ItemContent>
									<ItemActions>
										<Input
											className="w-64"
											onChange={(event) =>
												updateSingleSetting(
													"proxy",
													event.target.value,
													updateSettings,
												)
											}
											placeholder={t("settings.proxyPlaceholder")}
											value={settings.proxy}
										/>
									</ItemActions>
								</Item>
							</ItemGroup>

							<ItemGroup>
								<Item variant="muted">
									<ItemContent>
										<ItemTitle>{t("settings.configFile")}</ItemTitle>
										<ItemDescription>
											{t("settings.configFileDescription")}
										</ItemDescription>
									</ItemContent>
									<ItemActions>
										<div className="flex w-full max-w-md gap-2">
											<Input
												className="flex-1"
												readOnly
												value={settings.configPath}
											/>
											<Button
												disabled={configFileUploading}
												onClick={handleSelectConfigFile}
											>
												{configFileUploading
													? t("download.loading")
													: t("settings.selectPath")}
											</Button>
											<Button
												disabled={configFileUploading || !settings.configPath}
												onClick={() =>
													updateSingleSetting("configPath", "", updateSettings)
												}
												variant="secondary"
											>
												{t("settings.clearConfigFile")}
											</Button>
										</div>
									</ItemActions>
								</Item>
							</ItemGroup>

							<ItemGroup>
								<Item variant="muted">
									<ItemContent>
										<ItemTitle>{t("settings.enableAnalytics")}</ItemTitle>
										<ItemDescription>
											{t("settings.enableAnalyticsDescription")}
										</ItemDescription>
									</ItemContent>
									<ItemActions>
										<Switch
											checked={settings.enableAnalytics}
											onCheckedChange={(value) =>
												updateSingleSetting(
													"enableAnalytics",
													value,
													updateSettings,
												)
											}
										/>
									</ItemActions>
								</Item>
							</ItemGroup>
						</TabsContent>

						<TabsContent className="mt-2 space-y-4" value="cookies">
							<ItemGroup>
								<Item variant="muted">
									<ItemContent>
										<ItemTitle>{t("settings.browserForCookies")}</ItemTitle>
										<ItemDescription>
											{t("settings.browserForCookiesDescription")}
										</ItemDescription>
										{platform === WINDOWS_PLATFORM && (
											<ItemDescription className="text-red-500">
												{t("settings.browserForCookiesWindowsNote")}
											</ItemDescription>
										)}
									</ItemContent>
									<ItemActions>
										<Select
											onValueChange={(value) =>
												updateSingleSetting(
													"browserForCookies",
													buildBrowserCookiesSetting(value, ""),
													updateSettings,
												)
											}
											value={browserForCookiesValue}
										>
											<SelectTrigger className="w-32">
												<SelectValue />
											</SelectTrigger>
											<SelectContent>
												<SelectItem value="none">
													{t("settings.none")}
												</SelectItem>
												<SelectItem value="chrome">
													{t("settings.browserOptions.chrome")}
												</SelectItem>
												<SelectItem value="chromium">
													{t("settings.browserOptions.chromium")}
												</SelectItem>
												<SelectItem value="firefox">
													{t("settings.browserOptions.firefox")}
												</SelectItem>
												<SelectItem value="edge">
													{t("settings.browserOptions.edge")}
												</SelectItem>
												<SelectItem value="safari">
													{t("settings.browserOptions.safari")}
												</SelectItem>
												<SelectItem value="brave">
													{t("settings.browserOptions.brave")}
												</SelectItem>
												<SelectItem value="opera">
													{t("settings.browserOptions.opera")}
												</SelectItem>
												<SelectItem value="vivaldi">
													{t("settings.browserOptions.vivaldi")}
												</SelectItem>
												<SelectItem value="whale">
													{t("settings.browserOptions.whale")}
												</SelectItem>
											</SelectContent>
										</Select>
									</ItemActions>
								</Item>

								<ItemSeparator />

								<Item variant="muted">
									<ItemContent className="basis-full">
										<ItemTitle>
											{t("settings.browserForCookiesProfile")}
										</ItemTitle>
										<ItemDescription>
											{t("settings.browserForCookiesProfileDescription")}
										</ItemDescription>
									</ItemContent>
									<ItemActions className="basis-full">
										<div className="relative w-full">
											<Input
												className="w-full pr-10"
												disabled={browserForCookiesValue === "none"}
												onChange={(event) =>
													updateSingleSetting(
														"browserForCookies",
														buildBrowserCookiesSetting(
															browserForCookiesValue,
															event.target.value,
														),
														updateSettings,
													)
												}
												placeholder={t(
													"settings.browserForCookiesProfilePlaceholder",
												)}
												value={browserCookiesProfileValue}
											/>
											{showBrowserProfileWarning ? (
												<Tooltip>
													<TooltipTrigger asChild>
														<span className="absolute top-1/2 right-3 inline-flex h-4 w-4 -translate-y-1/2 items-center justify-center text-amber-500">
															<AlertTriangle aria-hidden className="h-4 w-4" />
														</span>
													</TooltipTrigger>
													<TooltipContent>
														{getBrowserProfileWarningMessage(
															browserProfileValidation.reason,
															t,
														)}
													</TooltipContent>
												</Tooltip>
											) : null}
										</div>
									</ItemActions>
								</Item>
							</ItemGroup>

							<ItemGroup>
								<Item variant="muted">
									<ItemContent>
										<ItemTitle>{t("settings.cookiesFile")}</ItemTitle>
										<ItemDescription>
											{t("settings.cookiesFileDescription")}
										</ItemDescription>
									</ItemContent>
									<ItemActions>
										<div className="flex w-full max-w-md gap-2">
											<Input
												className="flex-1"
												readOnly
												value={settings.cookiesPath}
											/>
											<Button
												disabled={cookiesFileUploading}
												onClick={handleSelectCookiesFile}
											>
												{cookiesFileUploading
													? t("download.loading")
													: t("settings.selectPath")}
											</Button>
											<Button
												disabled={cookiesFileUploading || !settings.cookiesPath}
												onClick={() =>
													updateSingleSetting("cookiesPath", "", updateSettings)
												}
												variant="secondary"
											>
												{t("settings.clearCookiesFile")}
											</Button>
										</div>
									</ItemActions>
								</Item>
							</ItemGroup>

							<ItemGroup>
								<Item variant="muted">
									<ItemContent>
										<ItemTitle>{t("settings.cookiesHelpTitle")}</ItemTitle>
										<ul className="list-inside list-disc space-y-1 text-muted-foreground text-sm leading-normal">
											<li>{t("settings.cookiesHelpBrowser")}</li>
											<li>{t("settings.cookiesHelpFile")}</li>
										</ul>
									</ItemContent>
								</Item>

								<ItemSeparator />

								<Item variant="muted">
									<ItemContent>
										<ItemTitle>{t("settings.cookiesGuideTitle")}</ItemTitle>
										<ItemDescription>
											{t("settings.cookiesGuideDescription")}
										</ItemDescription>
									</ItemContent>
									<ItemActions>
										<Button
											className="px-0"
											onClick={handleOpenCookiesGuide}
											variant="link"
										>
											{t("settings.cookiesGuideLink")}
										</Button>
									</ItemActions>
								</Item>
							</ItemGroup>
						</TabsContent>
					</Tabs>

					<input
						className="sr-only"
						onChange={handleConfigFileInputChange}
						ref={configFileInputRef}
						type="file"
					/>
					<input
						accept=".txt"
						className="sr-only"
						onChange={handleCookiesFileInputChange}
						ref={cookiesFileInputRef}
						type="file"
					/>

					<Dialog
						onOpenChange={setDownloadPathDialogOpen}
						open={downloadPathDialogOpen}
					>
						<DialogContent className="sm:max-w-2xl">
							<DialogHeader>
								<DialogTitle>{t("settings.downloadPath")}</DialogTitle>
								<DialogDescription>
									{t("settings.downloadPathDescription")}
								</DialogDescription>
							</DialogHeader>

							<div className="space-y-3">
								<Input
									onChange={(event) => setServerPathInput(event.target.value)}
									onKeyDown={(event) => {
										if (event.key !== "Enter") {
											return;
										}
										event.preventDefault();
										handleSubmitServerPathInput();
									}}
									value={serverPathInput}
								/>

								<div className="flex items-center gap-2">
									<Button
										disabled={serverPathLoading || !serverParentPath}
										onClick={() =>
											serverParentPath
												? handleNavigateServerDirectory(serverParentPath)
												: undefined
										}
										variant="secondary"
									>
										{t("download.back")}
									</Button>
									<Button
										disabled={serverPathLoading || !serverPathInput.trim()}
										onClick={handleSubmitServerPathInput}
										variant="secondary"
									>
										<RefreshCw className="mr-1 h-4 w-4" />
										{t("download.fetch")}
									</Button>
								</div>

								<div className="max-h-64 overflow-auto rounded-md border">
									{serverPathLoading ? (
										<div className="p-3 text-muted-foreground text-sm">
											{t("download.loading")}
										</div>
									) : null}
									{serverPathError ? (
										<div className="p-3 text-destructive text-sm">
											{serverPathError}
										</div>
									) : null}
									{!serverPathLoading &&
									!serverPathError &&
									serverDirectories.length === 0 ? (
										<div className="p-3 text-muted-foreground text-sm">
											{t("download.noItems")}
										</div>
									) : null}
									{!serverPathLoading && !serverPathError ? (
										<div className="divide-y">
											{serverDirectories.map((directory) => (
												<button
													className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-muted"
													key={directory.path}
													onClick={() =>
														handleNavigateServerDirectory(directory.path)
													}
													type="button"
												>
													<Folder className="h-4 w-4 text-muted-foreground" />
													<span className="truncate">{directory.name}</span>
												</button>
											))}
										</div>
									) : null}
								</div>
							</div>

							<DialogFooter>
								<Button
									onClick={() => setDownloadPathDialogOpen(false)}
									variant="outline"
								>
									{t("download.cancel")}
								</Button>
								<Button
									disabled={serverPathLoading || !serverCurrentPath}
									onClick={handleSelectCurrentServerPath}
								>
									{t("settings.selectPath")}
								</Button>
							</DialogFooter>
						</DialogContent>
					</Dialog>
				</div>
			</div>
		</AppShell>
	);
};
