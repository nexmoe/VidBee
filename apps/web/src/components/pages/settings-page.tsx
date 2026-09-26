import { useNavigate } from "@tanstack/react-router";
import { looksLikeNetscapeCookies } from "@vidbee/downloader-core/cookie-setup";
import {
	applyViaVidBeeFilename,
	FILENAME_STYLE_PREVIEWS,
	FILENAME_STYLES,
	type FilenameStyle,
	isFilenameStyle,
} from "@vidbee/downloader-core/filename-style";
import {
	FOLLOW_INTERFACE_SUBTITLE_LANGUAGE,
	MAX_SUBTITLE_LANGUAGES,
} from "@vidbee/downloader-core/subtitle-languages";
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
	ItemMedia,
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
import { SettingsSectionNav } from "@vidbee/ui/components/ui/settings-section-nav";
import { SubtitleLanguagePicker } from "@vidbee/ui/components/ui/subtitle-language-picker";
import { Switch } from "@vidbee/ui/components/ui/switch";
import {
	TabItem,
	TabPanel,
	Tabs,
	TabsList,
} from "@vidbee/ui/components/ui/tabs";
import { WebmThumbnailNotice } from "@vidbee/ui/components/ui/webm-thumbnail-notice";
import {
	Captions,
	Cookie,
	FileText,
	Film,
	Folder,
	Music,
	RefreshCw,
	Settings2,
	SlidersHorizontal,
} from "lucide-react";
import {
	type ChangeEvent,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useWebSettings } from "../../hooks/use-web-settings";
import type {
	OneClickContainerOption,
	OneClickQualityPreset,
} from "../../lib/download-format-preferences";
import { orpcClient } from "../../lib/orpc-client";
import {
	ASR_TIERS,
	type AsrTier,
	type ThemeValue,
	type WebAppSettings,
} from "../../lib/web-settings";
import { AppShell } from "../layout/app-shell";
import { CookiesSetupSection } from "../settings/cookies-setup-section";

type SettingsTab =
	| "advanced"
	| "cookies"
	| "general"
	| "metadata"
	| "transcribe";

const WEB_SETTINGS_NAV_ITEMS = [
	{ icon: Settings2, labelKey: "settings.general", value: "general" },
	{ icon: FileText, labelKey: "settings.metadataTab", value: "metadata" },
	{ icon: Cookie, labelKey: "settings.cookiesTab", value: "cookies" },
	{
		icon: Captions,
		labelKey: "settings.transcriptionTab",
		value: "transcribe",
	},
	{ icon: SlidersHorizontal, labelKey: "settings.advanced", value: "advanced" },
] as const;

const WEB_SETTINGS_NAV_GROUPS = [
	{ id: "app", labelKey: "settings.navGroup.app", values: ["general"] },
	{
		id: "download",
		labelKey: "settings.navGroup.download",
		values: ["metadata", "cookies"],
	},
	{ id: "ai", labelKey: "settings.navGroup.ai", values: ["transcribe"] },
	{ id: "system", labelKey: "settings.navGroup.system", values: ["advanced"] },
] as const;

interface ServerDirectoryEntry {
	name: string;
	path: string;
}

const MAX_SETTINGS_UPLOAD_BYTES = 500_000;

const toSelectString = (value: number): string => value.toString();

const updateSingleSetting = <K extends keyof WebAppSettings>(
	key: K,
	value: WebAppSettings[K],
	updateSettings: (updates: Partial<WebAppSettings>) => void,
) => {
	updateSettings({ [key]: value } as Pick<WebAppSettings, K>);
};

export const SettingsPage = () => {
	const { t } = useTranslation();
	const navigate = useNavigate();
	const { settings, updateSettings } = useWebSettings();
	const [activeTab, setActiveTab] = useState<SettingsTab>("general");
	const [serverDownloadDir, setServerDownloadDir] = useState("");
	const [serverDataDir, setServerDataDir] = useState("");
	const [serverDbPath, setServerDbPath] = useState("");
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

	useEffect(() => {
		let disposed = false;
		void orpcClient
			.status()
			.then((status) => {
				if (disposed) {
					return;
				}
				setServerDownloadDir(status.downloadDir ?? "");
				setServerDataDir(status.dataDir ?? "");
				setServerDbPath(status.dbPath ?? "");
			})
			.catch(() => undefined);
		return () => {
			disposed = true;
		};
	}, []);

	useEffect(() => {
		if (typeof window === "undefined") {
			return;
		}

		const searchParams = new URLSearchParams(window.location.search);
		const tab = searchParams.get("tab");
		if (
			tab === "general" ||
			tab === "advanced" ||
			tab === "cookies" ||
			tab === "metadata" ||
			tab === "transcribe"
		) {
			setActiveTab(tab);
		}
	}, []);

	const languageOptions = languageList;
	const activeLanguageCode = normalizeLanguageCode(settings.language);
	const currentLanguage =
		languageOptions.find((option) => option.value === activeLanguageCode) ??
		languageOptions[0];
	const subtitleLanguageOptions = [
		{
			label: t("settings.followInterfaceLanguage", {
				language: currentLanguage.name,
			}),
			languageTag: currentLanguage.hreflang,
			value: FOLLOW_INTERFACE_SUBTITLE_LANGUAGE,
		},
		...languageOptions.map((option) => ({
			label: option.name,
			languageTag: option.hreflang,
			value: option.value,
		})),
	];

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

	const handleTabChange = useCallback(
		(tab: string) => {
			const nextTab = tab as SettingsTab;
			setActiveTab(nextTab);
			void navigate({ search: { tab: nextTab }, to: "/settings" });
		},
		[navigate],
	);

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

	/**
	 * Upload a Netscape cookies file after rejecting non-text exports.
	 *
	 * @param event File input change event.
	 */
	const handleCookiesFileInputChange = (
		event: ChangeEvent<HTMLInputElement>,
	) => {
		const selectedFile = event.target.files?.[0];
		event.target.value = "";
		if (!selectedFile) {
			return;
		}

		setCookiesFileUploading(true);
		void selectedFile
			.text()
			.then(async (text) => {
				if (!looksLikeNetscapeCookies(text)) {
					throw new Error(t("settings.cookiesFileInvalidFormat"));
				}
				const serverPath = await uploadSelectedSettingsFile(
					"cookies",
					selectedFile,
				);
				updateSettings({ browserForCookies: "none", cookiesPath: serverPath });
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

	const activeNavLabelKey =
		WEB_SETTINGS_NAV_ITEMS.find((item) => item.value === activeTab)?.labelKey ??
		"settings.general";

	return (
		<AppShell page="settings">
			<div className="flex h-full min-h-0 bg-background">
				<aside className="flex w-60 shrink-0 flex-col border-border/60 border-r bg-muted/30">
					<div className="px-6 pt-6 pb-4">
						<h1 className="pl-3 font-bold text-lg tracking-tight">
							{t("settings.title")}
						</h1>
					</div>
					<SettingsSectionNav
						activeTab={activeTab}
						groups={WEB_SETTINGS_NAV_GROUPS}
						items={WEB_SETTINGS_NAV_ITEMS}
						onChange={handleTabChange}
					/>
				</aside>

				<div className="flex min-h-0 min-w-0 flex-1 flex-col">
					<div className="min-h-0 flex-1 overflow-y-auto">
						<div className="mx-auto max-w-3xl space-y-6 p-6">
							<div className="space-y-1">
								<h2 className="font-semibold text-2xl leading-tight">
									{t(activeNavLabelKey)}
								</h2>
							</div>
							<Tabs onValueChange={handleTabChange} value={activeTab}>
								<TabPanel className="space-y-4" value="general">
									<ItemGroup>
										<Item variant="muted">
											<ItemContent>
												<ItemTitle>{t("settings.downloadPath")}</ItemTitle>
												<ItemDescription>
													{t("web.downloadPathDescription")}
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

										{serverDownloadDir || serverDataDir || serverDbPath ? (
											<>
												<ItemSeparator />
												<Item variant="muted">
													<ItemContent>
														<ItemTitle>{t("web.storageTitle")}</ItemTitle>
														<ItemDescription>
															{[
																serverDownloadDir
																	? `${t("web.storageDownloadDir")}: ${serverDownloadDir}`
																	: null,
																serverDataDir
																	? `${t("web.storageDataDir")}: ${serverDataDir}`
																	: null,
																serverDbPath
																	? `${t("web.storageDbFile")}: ${serverDbPath}`
																	: null,
															]
																.filter(Boolean)
																.join(" · ")}
														</ItemDescription>
													</ItemContent>
												</Item>
											</>
										) : null}

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
															<span lang={currentLanguage.hreflang}>
																{currentLanguage.name}
															</span>
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
																<span lang={option.hreflang}>
																	{option.name}
																</span>
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
													label=""
													onToggle={() =>
														updateSingleSetting(
															"oneClickDownload",
															!settings.oneClickDownload,
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
														<ItemTitle>
															{t("settings.oneClickQuality")}
														</ItemTitle>
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
												<ItemSeparator />
												<Item variant="muted">
													<ItemContent>
														<ItemTitle>
															{t("settings.oneClickContainer")}
														</ItemTitle>
														<ItemDescription>
															{t("settings.oneClickContainerDescription")}
														</ItemDescription>
														<WebmThumbnailNotice
															container={settings.oneClickContainer}
														/>
													</ItemContent>
													<ItemActions>
														<Select
															onValueChange={(value) =>
																updateSingleSetting(
																	"oneClickContainer",
																	value as OneClickContainerOption,
																	updateSettings,
																)
															}
															value={settings.oneClickContainer ?? "auto"}
														>
															<SelectTrigger className="w-40">
																<SelectValue />
															</SelectTrigger>
															<SelectContent>
																<SelectItem value="auto">
																	{t("settings.oneClickContainerOptions.auto")}
																</SelectItem>
																<SelectItem value="mp4">
																	{t("settings.oneClickContainerOptions.mp4")}
																</SelectItem>
																<SelectItem value="mkv">
																	{t("settings.oneClickContainerOptions.mkv")}
																</SelectItem>
																<SelectItem value="webm">
																	{t("settings.oneClickContainerOptions.webm")}
																</SelectItem>
																<SelectItem value="original">
																	{t(
																		"settings.oneClickContainerOptions.original",
																	)}
																</SelectItem>
															</SelectContent>
														</Select>
													</ItemActions>
												</Item>
											</>
										)}
									</ItemGroup>
								</TabPanel>

								<TabPanel className="space-y-4" value="metadata">
									<FilenameStylePicker
										filenameViaVidBee={settings.filenameViaVidBee ?? true}
										onChange={(style) =>
											updateSingleSetting(
												"filenameStyle",
												style,
												updateSettings,
											)
										}
										onFilenameViaVidBeeChange={(enabled) =>
											updateSingleSetting(
												"filenameViaVidBee",
												enabled,
												updateSettings,
											)
										}
										value={settings.filenameStyle}
									/>

									<ItemGroup>
										<Item variant="muted">
											<ItemContent>
												<ItemTitle>
													{t("settings.downloadWithoutChannelSubfolders")}
												</ItemTitle>
												<ItemDescription>
													{t(
														"settings.downloadWithoutChannelSubfoldersDescription",
													)}
												</ItemDescription>
											</ItemContent>
											<ItemActions>
												<Switch
													checked={settings.downloadWithoutChannelSubfolders}
													label=""
													onToggle={() =>
														updateSingleSetting(
															"downloadWithoutChannelSubfolders",
															!settings.downloadWithoutChannelSubfolders,
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
												<ItemTitle>{t("settings.downloadSubtitles")}</ItemTitle>
												<ItemDescription>
													{t("settings.downloadSubtitlesDescription")}
												</ItemDescription>
											</ItemContent>
											<ItemActions>
												<Switch
													checked={settings.downloadSubtitles}
													label=""
													onToggle={() =>
														updateSingleSetting(
															"downloadSubtitles",
															!settings.downloadSubtitles,
															updateSettings,
														)
													}
												/>
											</ItemActions>
										</Item>

										{settings.downloadSubtitles && (
											<>
												<ItemSeparator />

												<Item variant="muted">
													<ItemContent>
														<ItemTitle>
															{t("settings.subtitleLanguages")}
														</ItemTitle>
														<ItemDescription>
															{t("settings.subtitleLanguagesDescription")}
														</ItemDescription>
													</ItemContent>
													<ItemActions>
														<SubtitleLanguagePicker
															ariaLabel={t("settings.subtitleLanguages")}
															emptyLabel={t("settings.subtitleLanguageEmpty")}
															limitLabel={t("settings.subtitleLanguageLimit", {
																count: MAX_SUBTITLE_LANGUAGES,
															})}
															maxSelections={MAX_SUBTITLE_LANGUAGES}
															onValueChange={(values) =>
																updateSingleSetting(
																	"subtitleLanguages",
																	values,
																	updateSettings,
																)
															}
															options={subtitleLanguageOptions}
															searchPlaceholder={t(
																"settings.subtitleLanguageSearch",
															)}
															values={settings.subtitleLanguages}
														/>
													</ItemActions>
												</Item>

												<ItemSeparator />

												<Item variant="muted">
													<ItemContent>
														<ItemTitle>{t("settings.writeAutoSubs")}</ItemTitle>
														<ItemDescription>
															{t("settings.writeAutoSubsDescription")}
														</ItemDescription>
													</ItemContent>
													<ItemActions>
														<Switch
															checked={settings.writeAutoSubs}
															label=""
															onToggle={() =>
																updateSingleSetting(
																	"writeAutoSubs",
																	!settings.writeAutoSubs,
																	updateSettings,
																)
															}
														/>
													</ItemActions>
												</Item>

												<ItemSeparator />

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
															label=""
															onToggle={() =>
																updateSingleSetting(
																	"embedSubs",
																	!settings.embedSubs,
																	updateSettings,
																)
															}
														/>
													</ItemActions>
												</Item>
											</>
										)}

										<ItemSeparator />

										<Item variant="muted">
											<ItemContent>
												<ItemTitle>{t("settings.embedThumbnail")}</ItemTitle>
												<ItemDescription>
													{t("settings.embedThumbnailDescription")}
												</ItemDescription>
												<WebmThumbnailNotice
													container={settings.oneClickContainer}
												/>
											</ItemContent>
											<ItemActions>
												<Switch
													checked={settings.embedThumbnail}
													label=""
													onToggle={() =>
														updateSingleSetting(
															"embedThumbnail",
															!settings.embedThumbnail,
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
													label=""
													onToggle={() =>
														updateSingleSetting(
															"embedMetadata",
															!settings.embedMetadata,
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
													label=""
													onToggle={() =>
														updateSingleSetting(
															"embedChapters",
															!settings.embedChapters,
															updateSettings,
														)
													}
												/>
											</ItemActions>
										</Item>
									</ItemGroup>
								</TabPanel>

								<TabPanel className="space-y-4" value="advanced">
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
													value={toSelectString(
														settings.maxConcurrentDownloads,
													)}
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

										<ItemSeparator />

										<Item variant="muted">
											<ItemContent>
												<ItemTitle>{t("settings.downloadMirror")}</ItemTitle>
												<ItemDescription>
													{t("settings.downloadMirrorDescription")}
												</ItemDescription>
											</ItemContent>
											<ItemActions>
												<Select
													onValueChange={(value) =>
														updateSingleSetting(
															"downloadMirror",
															value as WebAppSettings["downloadMirror"],
															updateSettings,
														)
													}
													value={settings.downloadMirror}
												>
													<SelectTrigger className="w-40">
														<SelectValue />
													</SelectTrigger>
													<SelectContent>
														<SelectItem value="auto">
															{t("settings.downloadMirrorAuto")}
														</SelectItem>
														<SelectItem value="cn">
															{t("settings.downloadMirrorChina")}
														</SelectItem>
														<SelectItem value="global">
															{t("settings.downloadMirrorGlobal")}
														</SelectItem>
													</SelectContent>
												</Select>
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
														disabled={
															configFileUploading || !settings.configPath
														}
														onClick={() =>
															updateSingleSetting(
																"configPath",
																"",
																updateSettings,
															)
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
													label=""
													onToggle={() =>
														updateSingleSetting(
															"enableAnalytics",
															!settings.enableAnalytics,
															updateSettings,
														)
													}
												/>
											</ItemActions>
										</Item>

										<ItemSeparator />

										<Item variant="muted">
											<ItemContent>
												<ItemTitle>
													{t("settings.enableDownloadNotifications")}
												</ItemTitle>
												<ItemDescription>
													{t("settings.enableDownloadNotificationsDescription")}
												</ItemDescription>
											</ItemContent>
											<ItemActions>
												<Switch
													checked={settings.enableDownloadNotifications}
													label=""
													onToggle={() => {
														const next = !settings.enableDownloadNotifications;
														if (
															next &&
															typeof Notification !== "undefined" &&
															Notification.permission === "default"
														) {
															void Notification.requestPermission();
														}
														updateSingleSetting(
															"enableDownloadNotifications",
															next,
															updateSettings,
														);
													}}
												/>
											</ItemActions>
										</Item>

										<ItemSeparator />

										<Item variant="muted">
											<ItemContent>
												<ItemTitle>
													{t("settings.rememberLastAudioLanguage")}
												</ItemTitle>
												<ItemDescription>
													{t("settings.rememberLastAudioLanguageDescription")}
												</ItemDescription>
											</ItemContent>
											<ItemActions>
												<Switch
													checked={settings.rememberLastAudioLanguage}
													label=""
													onToggle={() =>
														updateSingleSetting(
															"rememberLastAudioLanguage",
															!settings.rememberLastAudioLanguage,
															updateSettings,
														)
													}
												/>
											</ItemActions>
										</Item>
									</ItemGroup>
								</TabPanel>

								<TabPanel className="space-y-4" value="cookies">
									<CookiesSetupSection
										cookiesFileUploading={cookiesFileUploading}
										onSelectCookiesFile={handleSelectCookiesFile}
										settings={settings}
										updateSettings={updateSettings}
									/>
								</TabPanel>

								<TabPanel className="space-y-4" value="transcribe">
									<ItemGroup>
										<Item variant="muted">
											<ItemContent>
												<ItemTitle>
													{t("settings.autoTranscribeAfterDownload")}
												</ItemTitle>
												<ItemDescription>
													{t("web.autoTranscribeAfterDownloadDescription")}
												</ItemDescription>
											</ItemContent>
											<ItemActions>
												<Switch
													checked={settings.autoTranscribeAfterDownload}
													label=""
													onToggle={() =>
														updateSingleSetting(
															"autoTranscribeAfterDownload",
															!settings.autoTranscribeAfterDownload,
															updateSettings,
														)
													}
												/>
											</ItemActions>
										</Item>

										<ItemSeparator />

										<Item variant="muted">
											<ItemContent>
												<ItemTitle>
													{t("settings.maxConcurrentTranscriptions")}
												</ItemTitle>
												<ItemDescription>
													{t("web.maxConcurrentTranscriptionsDescription")}
												</ItemDescription>
											</ItemContent>
											<ItemActions>
												<Select
													onValueChange={(value) =>
														updateSingleSetting(
															"maxConcurrentTranscriptions",
															Number(value),
															updateSettings,
														)
													}
													value={toSelectString(
														settings.maxConcurrentTranscriptions,
													)}
												>
													<SelectTrigger className="w-20">
														<SelectValue />
													</SelectTrigger>
													<SelectContent>
														{[1, 2, 3, 4].map((num) => (
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
												<ItemTitle>
													{t("settings.transcriptModelsTitle")}
												</ItemTitle>
												<ItemDescription>
													{t("web.transcriptModelsDescription")}
												</ItemDescription>
											</ItemContent>
											<ItemActions>
												<Select
													onValueChange={(value) =>
														updateSingleSetting(
															"asrTier",
															value as AsrTier,
															updateSettings,
														)
													}
													value={settings.asrTier}
												>
													<SelectTrigger className="w-52">
														<SelectValue />
													</SelectTrigger>
													<SelectContent>
														{ASR_TIERS.map((tier) => (
															<SelectItem key={tier} value={tier}>
																{t(`settings.asrTier.${tier}.title`)}
															</SelectItem>
														))}
													</SelectContent>
												</Select>
											</ItemActions>
										</Item>
									</ItemGroup>
								</TabPanel>
							</Tabs>
						</div>
					</div>

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

/**
 * Segmented filename-style control with video and audio previews.
 *
 * @param props.value Current filename style from settings.
 * @param props.onChange Persist the selected style.
 * @param props.filenameViaVidBee Whether via VidBee is appended to filenames.
 * @param props.onFilenameViaVidBeeChange Persist the via VidBee toggle.
 */
const FilenameStylePicker = ({
	filenameViaVidBee,
	onChange,
	onFilenameViaVidBeeChange,
	value,
}: {
	filenameViaVidBee: boolean;
	onChange: (style: FilenameStyle) => void;
	onFilenameViaVidBeeChange: (enabled: boolean) => void;
	value?: FilenameStyle;
}) => {
	const { t } = useTranslation();
	const selectedStyle = isFilenameStyle(value) ? value : "pretty";
	const preview = FILENAME_STYLE_PREVIEWS[selectedStyle];

	return (
		<ItemGroup>
			<Item className="flex-col items-stretch gap-3" variant="muted">
				<ItemContent>
					<ItemTitle>{t("settings.filenameStyle")}</ItemTitle>
					<ItemDescription>
						{t("settings.filenameStyleDescription")}
					</ItemDescription>
				</ItemContent>
				<Tabs
					className="w-full"
					onValueChange={(style) => {
						if (isFilenameStyle(style)) {
							onChange(style);
						}
					}}
					value={selectedStyle}
				>
					<TabsList className="flex w-full">
						{FILENAME_STYLES.map((style) => (
							<TabItem
								className="flex-1 justify-center"
								key={style}
								label={t(`settings.filenameStyleOptions.${style}`)}
								value={style}
							/>
						))}
					</TabsList>
				</Tabs>
			</Item>

			<ItemSeparator />

			<Item variant="muted">
				<ItemMedia variant="icon">
					<Film />
				</ItemMedia>
				<ItemContent>
					<ItemTitle className="w-full min-w-0 max-w-full break-all font-medium">
						{applyViaVidBeeFilename(preview.video, filenameViaVidBee)}
					</ItemTitle>
					<ItemDescription>
						{t("settings.filenameStylePreviewVideo")}
					</ItemDescription>
				</ItemContent>
			</Item>

			<ItemSeparator />

			<Item variant="muted">
				<ItemMedia variant="icon">
					<Music />
				</ItemMedia>
				<ItemContent>
					<ItemTitle className="w-full min-w-0 max-w-full break-all font-medium">
						{applyViaVidBeeFilename(preview.audio, filenameViaVidBee)}
					</ItemTitle>
					<ItemDescription>
						{t("settings.filenameStylePreviewAudio")}
					</ItemDescription>
				</ItemContent>
			</Item>

			<ItemSeparator />

			<Item variant="muted">
				<ItemContent>
					<ItemTitle>{t("settings.filenameViaVidBee")}</ItemTitle>
					<ItemDescription>
						{t("settings.filenameViaVidBeeDescription")}
					</ItemDescription>
				</ItemContent>
				<ItemActions>
					<Switch
						checked={filenameViaVidBee}
						label=""
						onToggle={() => onFilenameViaVidBeeChange(!filenameViaVidBee)}
					/>
				</ItemActions>
			</Item>

			<ItemSeparator />

			<Item variant="muted">
				<ItemContent>
					<ItemDescription className="line-clamp-none">
						{t("settings.filenameStyleNote")}
					</ItemDescription>
				</ItemContent>
			</Item>
		</ItemGroup>
	);
};
