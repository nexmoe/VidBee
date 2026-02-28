import type {
	PlaylistInfo,
	VideoFormat,
	VideoInfo,
} from "@vidbee/downloader-core";
import { Button } from "@vidbee/ui/components/ui/button";
import { Checkbox } from "@vidbee/ui/components/ui/checkbox";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
} from "@vidbee/ui/components/ui/dialog";
import { Input } from "@vidbee/ui/components/ui/input";
import { Label } from "@vidbee/ui/components/ui/label";
import { RemoteImage } from "@vidbee/ui/components/ui/remote-image";
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
import { cn } from "@vidbee/ui/lib/cn";
import { FolderOpen, List, Loader2, Plus, Rocket, Video } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useWebDownloadSettings } from "../../hooks/use-web-download-settings";
import {
	buildAudioFormatPreference,
	buildVideoFormatPreference,
} from "../../lib/download-format-preferences";
import { orpcClient } from "../../lib/orpc-client";
import { readOrpcDownloadSettings } from "../../lib/orpc-download-settings";
import { PlaylistDownload } from "./playlist-download";
import {
	SingleVideoDownload,
	type SingleVideoState,
} from "./single-video-download";

const isLikelyUrl = (value: string): boolean => {
	try {
		const parsed = new URL(value);
		return parsed.protocol === "http:" || parsed.protocol === "https:";
	} catch {
		return false;
	}
};

const isMuxedVideoFormat = (format: VideoFormat | undefined): boolean =>
	Boolean(
		format?.vcodec &&
			format.vcodec !== "none" &&
			format.acodec &&
			format.acodec !== "none",
	);

const resolvePreferredAudioExt = (
	videoExt: string | undefined,
): string | undefined => {
	if (!videoExt) {
		return undefined;
	}

	const normalizedExt = videoExt.toLowerCase();
	if (normalizedExt === "mp4") {
		return "m4a";
	}
	if (normalizedExt === "webm") {
		return "webm";
	}
	return undefined;
};

const buildSingleVideoFormatSelector = (
	formatId: string,
	format: VideoFormat | undefined,
): string => {
	if (!format || isMuxedVideoFormat(format)) {
		return formatId;
	}

	const preferredAudioExt = resolvePreferredAudioExt(format.ext);
	if (!preferredAudioExt) {
		return `${formatId}+bestaudio`;
	}

	// Prefer same-container audio and keep a fallback when not available.
	return `${formatId}+bestaudio[ext=${preferredAudioExt}]/${formatId}+bestaudio`;
};

interface DownloadDialogProps {
	onDownloadsChanged?: () => Promise<void> | void;
}

export function DownloadDialog({ onDownloadsChanged }: DownloadDialogProps) {
	const { t } = useTranslation();
	const [open, setOpen] = useState(false);
	const [videoInfo, setVideoInfo] = useState<VideoInfo | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const { settings, updateSettings } = useWebDownloadSettings();

	const [url, setUrl] = useState("");
	const [activeTab, setActiveTab] = useState<"single" | "playlist">("single");
	const [clipboardPreviewHost, setClipboardPreviewHost] = useState("");
	const [clipboardPreviewStatus, setClipboardPreviewStatus] = useState<
		"idle" | "url" | "invalid" | "empty"
	>("idle");
	const [clipboardIconLoading, setClipboardIconLoading] = useState(false);
	const [clipboardIconFailed, setClipboardIconFailed] = useState(false);

	const [singleVideoState, setSingleVideoState] = useState<SingleVideoState>({
		title: "",
		activeTab: "video",
		selectedVideoFormat: "",
		selectedAudioFormat: "",
		selectedContainer: undefined,
		selectedCodec: undefined,
		selectedFps: undefined,
	});

	const downloadTypeId = useId();
	const advancedOptionsId = useId();
	const [playlistUrl, setPlaylistUrl] = useState("");
	const [downloadType, setDownloadType] = useState<"video" | "audio">("video");
	const [startIndex, setStartIndex] = useState("1");
	const [endIndex, setEndIndex] = useState("");
	const [playlistInfo, setPlaylistInfo] = useState<PlaylistInfo | null>(null);
	const [playlistPreviewLoading, setPlaylistPreviewLoading] = useState(false);
	const [playlistDownloadLoading, setPlaylistDownloadLoading] = useState(false);
	const [playlistPreviewError, setPlaylistPreviewError] = useState<
		string | null
	>(null);
	const playlistBusy = playlistPreviewLoading || playlistDownloadLoading;
	const [advancedOptionsOpen, setAdvancedOptionsOpen] = useState(false);
	const [selectedEntryIds, setSelectedEntryIds] = useState<Set<string>>(
		new Set(),
	);
	const lockDialogHeight =
		activeTab === "playlist" &&
		(playlistPreviewLoading || playlistInfo !== null);

	const notifyDownloadsChanged = useCallback(async () => {
		if (!onDownloadsChanged) {
			return;
		}
		await onDownloadsChanged();
	}, [onDownloadsChanged]);

	const computePlaylistRange = useCallback(
		(info: PlaylistInfo) => {
			const parsedStart = Math.max(Number.parseInt(startIndex, 10) || 1, 1);
			const rawEnd = endIndex
				? Math.max(Number.parseInt(endIndex, 10), parsedStart)
				: undefined;
			const start =
				info.entryCount > 0
					? Math.min(parsedStart, info.entryCount)
					: parsedStart;
			const endValue =
				rawEnd !== undefined
					? info.entryCount > 0
						? Math.min(rawEnd, info.entryCount)
						: rawEnd
					: undefined;
			return { start, end: endValue };
		},
		[startIndex, endIndex],
	);

	const selectedPlaylistEntries = useMemo(() => {
		if (!playlistInfo) {
			return [];
		}
		if (selectedEntryIds.size > 0) {
			return playlistInfo.entries.filter((entry) =>
				selectedEntryIds.has(entry.id),
			);
		}
		const range = computePlaylistRange(playlistInfo);
		const previewEnd = range.end ?? playlistInfo.entryCount;
		return playlistInfo.entries.filter(
			(entry) => entry.index >= range.start && entry.index <= previewEnd,
		);
	}, [playlistInfo, computePlaylistRange, selectedEntryIds]);

	const fetchVideoInfo = useCallback(
		async (targetUrl: string) => {
			const trimmedUrl = targetUrl.trim();
			if (!trimmedUrl) {
				toast.error(t("errors.emptyUrl"));
				return;
			}

			setLoading(true);
			setError(null);
			setVideoInfo(null);

			try {
				const result = await orpcClient.videoInfo({
					url: trimmedUrl,
					settings: readOrpcDownloadSettings(),
				});
				setVideoInfo(result.video);
			} catch (fetchError) {
				const message =
					fetchError instanceof Error && fetchError.message
						? fetchError.message
						: t("errors.fetchInfoFailed");
				setError(message);
			} finally {
				setLoading(false);
			}
		},
		[t],
	);

	const startOneClickDownload = useCallback(
		async (
			targetUrl: string,
			options?: { clearInput?: boolean; setInputValue?: boolean },
		) => {
			const trimmedUrl = targetUrl.trim();
			if (!trimmedUrl) {
				toast.error(t("errors.emptyUrl"));
				return;
			}

			if (options?.setInputValue) {
				setUrl(trimmedUrl);
			}

			const format =
				settings.oneClickDownloadType === "video"
					? buildVideoFormatPreference(settings)
					: buildAudioFormatPreference(settings);

			try {
				await orpcClient.downloads.create({
					url: trimmedUrl,
					type: settings.oneClickDownloadType,
					format,
					audioFormat:
						settings.oneClickDownloadType === "audio" ? "mp3" : undefined,
					settings: readOrpcDownloadSettings(),
				});

				toast.success(t("download.oneClickDownloadStarted"));
				await notifyDownloadsChanged();
				if (options?.clearInput) {
					setUrl("");
				}
			} catch (startError) {
				console.error("Failed to start one-click download:", startError);
				toast.error(t("notifications.downloadFailed"));
			}
		},
		[notifyDownloadsChanged, settings, t],
	);

	const handleFetchVideo = useCallback(async () => {
		if (!url.trim()) {
			toast.error(t("errors.emptyUrl"));
			return;
		}
		setSingleVideoState((prev) => ({
			...prev,
			selectedVideoFormat: "",
			selectedAudioFormat: "",
			selectedContainer: undefined,
			selectedCodec: undefined,
			selectedFps: undefined,
		}));
		await fetchVideoInfo(url.trim());
	}, [url, fetchVideoInfo, t]);

	const handleAutoDetectClipboard = useCallback(async () => {
		if (!navigator.clipboard?.readText) {
			return;
		}

		let text = "";
		try {
			text = await navigator.clipboard.readText();
		} catch {
			return;
		}

		const trimmedUrl = text.trim();
		if (!trimmedUrl) {
			return;
		}
		if (!isLikelyUrl(trimmedUrl)) {
			toast.error(t("errors.invalidUrl"));
			return;
		}

		if (activeTab === "playlist") {
			if (playlistBusy || playlistUrl.trim()) {
				return;
			}

			setPlaylistUrl(trimmedUrl);
			setPlaylistInfo(null);
			setPlaylistPreviewError(null);
			setSelectedEntryIds(new Set());

			setPlaylistPreviewError(null);
			setPlaylistPreviewLoading(true);
			try {
				const info = await orpcClient.playlist.info({
					url: trimmedUrl,
					settings: readOrpcDownloadSettings(),
				});
				setPlaylistInfo(info.playlist);
				if (info.playlist.entryCount === 0) {
					toast.error(t("playlist.noEntries"));
					return;
				}
				toast.success(
					t("playlist.foundVideos", { count: info.playlist.entryCount }),
				);
			} catch (fetchError) {
				console.error("Failed to fetch playlist info:", fetchError);
				const message =
					fetchError instanceof Error && fetchError.message
						? fetchError.message
						: t("playlist.previewFailed");
				setPlaylistPreviewError(message);
				setPlaylistInfo(null);
				toast.error(t("playlist.previewFailed"));
			} finally {
				setPlaylistPreviewLoading(false);
			}
			return;
		}

		if (loading || url.trim()) {
			return;
		}

		setUrl(trimmedUrl);

		if (settings.oneClickDownload) {
			await startOneClickDownload(trimmedUrl, {
				setInputValue: false,
				clearInput: false,
			});
			setOpen(false);
			return;
		}

		await fetchVideoInfo(trimmedUrl);
	}, [
		activeTab,
		fetchVideoInfo,
		loading,
		playlistBusy,
		playlistUrl,
		settings.oneClickDownload,
		startOneClickDownload,
		t,
		url,
	]);

	const handleOpenDialog = useCallback(async () => {
		if (settings.oneClickDownload) {
			if (!navigator.clipboard?.readText) {
				toast.error(t("errors.pasteFromClipboard"));
				return;
			}

			let text = "";
			try {
				text = await navigator.clipboard.readText();
			} catch {
				toast.error(t("errors.pasteFromClipboard"));
				return;
			}

			const trimmedUrl = text.trim();
			if (!trimmedUrl) {
				toast.error(t("errors.clipboardEmpty"));
				return;
			}

			if (!isLikelyUrl(trimmedUrl)) {
				toast.error(t("errors.invalidUrl"));
				return;
			}

			await startOneClickDownload(trimmedUrl, {
				setInputValue: false,
				clearInput: false,
			});
			return;
		}

		if (!navigator.clipboard?.readText) {
			setOpen(true);
			return;
		}

		let text = "";
		try {
			text = await navigator.clipboard.readText();
		} catch {
			setOpen(true);
			return;
		}

		const trimmedUrl = text.trim();
		if (!trimmedUrl) {
			setOpen(true);
			return;
		}

		if (!isLikelyUrl(trimmedUrl)) {
			toast.error(t("errors.invalidUrl"));
			return;
		}

		setOpen(true);
	}, [settings.oneClickDownload, startOneClickDownload, t]);

	useEffect(() => {
		if (!open) {
			return;
		}
		void handleAutoDetectClipboard();
	}, [open, handleAutoDetectClipboard]);

	const handleOneClickDownload = useCallback(async () => {
		await startOneClickDownload(url, { clearInput: true });
		setOpen(false);
	}, [startOneClickDownload, url]);

	const handlePreviewPlaylist = useCallback(async () => {
		if (!playlistUrl.trim()) {
			toast.error(t("errors.emptyUrl"));
			return;
		}
		setPlaylistPreviewError(null);
		setPlaylistPreviewLoading(true);
		try {
			const trimmedUrl = playlistUrl.trim();
			const info = await orpcClient.playlist.info({
				url: trimmedUrl,
				settings: readOrpcDownloadSettings(),
			});
			setPlaylistInfo(info.playlist);
			setSelectedEntryIds(new Set());
			if (info.playlist.entryCount === 0) {
				toast.error(t("playlist.noEntries"));
				return;
			}
			toast.success(
				t("playlist.foundVideos", { count: info.playlist.entryCount }),
			);
		} catch (fetchError) {
			console.error("Failed to fetch playlist info:", fetchError);
			const message =
				fetchError instanceof Error && fetchError.message
					? fetchError.message
					: t("playlist.previewFailed");
			setPlaylistPreviewError(message);
			setPlaylistInfo(null);
			toast.error(t("playlist.previewFailed"));
		} finally {
			setPlaylistPreviewLoading(false);
		}
	}, [playlistUrl, t]);

	const handleDownloadPlaylist = useCallback(async () => {
		const trimmedUrl = playlistUrl.trim();
		if (!trimmedUrl) {
			toast.error(t("errors.emptyUrl"));
			return;
		}

		if (!playlistInfo) {
			toast.error(t("playlist.previewRequired"));
			return;
		}

		setPlaylistPreviewError(null);
		setPlaylistDownloadLoading(true);
		try {
			let start: number | undefined;
			let end: number | undefined;
			let entryIds: string[] | undefined;

			if (selectedEntryIds.size > 0) {
				const selectedEntries = playlistInfo.entries
					.filter((entry) => selectedEntryIds.has(entry.id))
					.sort((a, b) => a.index - b.index);
				const selectedIndices = selectedEntries
					.map(
						(entry) => entry.index,
					)
					.sort((a, b) => a - b);

				if (selectedEntries.length === 0) {
					toast.error(t("playlist.noEntriesSelected"));
					return;
				}

				entryIds = selectedEntries.map((entry) => entry.id);
				start = selectedIndices[0];
				end = selectedIndices.at(-1);
			} else {
				const range = computePlaylistRange(playlistInfo);
				const previewEnd = range.end ?? playlistInfo.entryCount;

				if (previewEnd < range.start || previewEnd === 0) {
					toast.error(t("playlist.noEntriesInRange"));
					return;
				}

				start = range.start;
				end = range.end;
			}

			const format =
				downloadType === "video"
					? buildVideoFormatPreference(settings)
					: buildAudioFormatPreference(settings);

			const result = await orpcClient.playlist.download({
				url: trimmedUrl,
				type: downloadType,
				format,
				audioFormat: downloadType === "audio" ? "mp3" : undefined,
				startIndex: start,
				endIndex: end,
				entryIds,
				settings: readOrpcDownloadSettings(),
			});

			if (result.result.totalCount === 0) {
				toast.error(t("playlist.noEntriesInRange"));
				return;
			}

			await notifyDownloadsChanged();
			setOpen(false);
		} catch (startError) {
			console.error("Failed to start playlist download:", startError);
			toast.error(t("playlist.downloadFailed"));
		} finally {
			setPlaylistDownloadLoading(false);
		}
	}, [
		playlistUrl,
		playlistInfo,
		selectedEntryIds,
		computePlaylistRange,
		downloadType,
		settings,
		notifyDownloadsChanged,
		t,
	]);

	useEffect(() => {
		if (videoInfo) {
			setSingleVideoState((prev) => ({
				...prev,
				title: videoInfo.title || prev.title,
			}));
		}
	}, [videoInfo]);

	const handleSingleVideoDownload = useCallback(async () => {
		if (!videoInfo) {
			return;
		}

		const type = singleVideoState.activeTab;
		const selectedFormat =
			type === "video"
				? singleVideoState.selectedVideoFormat
				: singleVideoState.selectedAudioFormat;
		if (!selectedFormat) {
			return;
		}

		const selectedVideoFormat =
			type === "video"
				? (videoInfo.formats || []).find(
						(format) => format.formatId === selectedFormat,
					)
				: undefined;
		const resolvedFormat =
			type === "video"
				? buildSingleVideoFormatSelector(selectedFormat, selectedVideoFormat)
				: selectedFormat;

		const targetUrl = videoInfo.webpageUrl || url.trim();
		if (!targetUrl) {
			toast.error(t("errors.emptyUrl"));
			return;
		}

		try {
			await orpcClient.downloads.create({
				url: targetUrl,
				type,
				title: singleVideoState.title || videoInfo.title,
				thumbnail: videoInfo.thumbnail,
				duration: videoInfo.duration,
				description: videoInfo.description,
				uploader: videoInfo.uploader,
				viewCount: videoInfo.viewCount,
				tags: videoInfo.tags,
				selectedFormat: selectedVideoFormat,
				format: resolvedFormat || undefined,
				audioFormat: type === "audio" ? "mp3" : undefined,
				settings: readOrpcDownloadSettings(),
			});

			await notifyDownloadsChanged();
			setOpen(false);
		} catch (startError) {
			console.error("Failed to start download:", startError);
			toast.error(t("notifications.downloadFailed"));
		}
	}, [notifyDownloadsChanged, singleVideoState, t, url, videoInfo]);

	useEffect(() => {
		if (!open) {
			setUrl("");
			setError(null);
			setLoading(false);
			setVideoInfo(null);
			setActiveTab("single");
			setSingleVideoState({
				title: "",
				activeTab: "video",
				selectedVideoFormat: "",
				selectedAudioFormat: "",
				selectedContainer: undefined,
				selectedCodec: undefined,
				selectedFps: undefined,
			});

			setPlaylistUrl("");
			setPlaylistInfo(null);
			setPlaylistPreviewError(null);
			setStartIndex("1");
			setEndIndex("");
			setSelectedEntryIds(new Set());
		}
	}, [open]);

	const handleSingleVideoStateChange = useCallback(
		(updates: Partial<SingleVideoState>) => {
			setSingleVideoState((prev) => ({ ...prev, ...updates }));
		},
		[],
	);

	const selectedSingleFormat =
		singleVideoState.activeTab === "video"
			? singleVideoState.selectedVideoFormat
			: singleVideoState.selectedAudioFormat;

	const loadClipboardPreview = useCallback(async () => {
		if (!navigator.clipboard?.readText) {
			setClipboardPreviewHost("");
			setClipboardPreviewStatus("empty");
			setClipboardIconLoading(false);
			setClipboardIconFailed(false);
			return;
		}

		try {
			const text = await navigator.clipboard.readText();
			const trimmed = text.trim();
			if (!trimmed) {
				setClipboardPreviewHost("");
				setClipboardPreviewStatus("empty");
				setClipboardIconLoading(false);
				setClipboardIconFailed(false);
				return;
			}
			if (!isLikelyUrl(trimmed)) {
				setClipboardPreviewHost("");
				setClipboardPreviewStatus("invalid");
				setClipboardIconLoading(false);
				setClipboardIconFailed(false);
				return;
			}
			const parsed = new URL(trimmed);
			setClipboardPreviewHost(parsed.hostname);
			setClipboardPreviewStatus("url");
			setClipboardIconLoading(true);
			setClipboardIconFailed(false);
		} catch {
			setClipboardPreviewHost("");
			setClipboardPreviewStatus("empty");
			setClipboardIconLoading(false);
			setClipboardIconFailed(false);
		}
	}, []);

	useEffect(() => {
		void loadClipboardPreview();
		const handleFocus = () => {
			void loadClipboardPreview();
		};
		window.addEventListener("focus", handleFocus);
		return () => window.removeEventListener("focus", handleFocus);
	}, [loadClipboardPreview]);

	return (
		<Dialog onOpenChange={setOpen} open={open}>
			<div className="flex items-center gap-4">
				<Tooltip>
					<TooltipTrigger asChild>
						<div className="relative">
							<Button
								className="rounded-full"
								onClick={() => {
									updateSettings({
										oneClickDownload: !settings.oneClickDownload,
									});
								}}
								size="icon"
								variant="ghost"
							>
								<Rocket className="h-4 w-4 text-muted-foreground" />
							</Button>
							<span
								className={`absolute top-0 -right-2 inline-flex h-3.5 items-center justify-center whitespace-nowrap rounded-full px-1 font-semibold text-xs leading-none ${settings.oneClickDownload ? "bg-being-green-400 text-primary-foreground" : "bg-secondary text-secondary-foreground"}`}
							>
								{settings.oneClickDownload ? "ON" : "OFF"}
							</span>
						</div>
					</TooltipTrigger>
					<TooltipContent className="max-w-xs" side="bottom">
						{t("download.oneClickDownloadTooltip")}
					</TooltipContent>
				</Tooltip>

				{clipboardPreviewStatus === "invalid" ? (
					<Tooltip open>
						<TooltipTrigger asChild>
							<span className="inline-flex">
								<Button className="rounded-full" disabled>
									<Plus className="h-4 w-4" />
									{t("download.pasteUrlButton")}
								</Button>
							</span>
						</TooltipTrigger>
						<TooltipContent align="end" side="bottom">
							{t("errors.invalidUrl")}
						</TooltipContent>
					</Tooltip>
				) : (
					<Button
						className="rounded-full"
						onClick={() => {
							void handleOpenDialog();
						}}
					>
						{clipboardPreviewStatus === "url" && clipboardPreviewHost ? (
							<>
								<RemoteImage
									alt={clipboardPreviewHost}
									className={cn(
										"h-4 w-4",
										(clipboardIconLoading || clipboardIconFailed) && "hidden",
									)}
									onError={() => setClipboardIconFailed(true)}
									onLoadingChange={(loadingState) =>
										setClipboardIconLoading(loadingState)
									}
									src={`https://unavatar.io/${clipboardPreviewHost}?fallback=false`}
									useCache={false}
								/>
								{(clipboardIconLoading || clipboardIconFailed) && (
									<Plus className="h-4 w-4" />
								)}
							</>
						) : (
							<Plus className="h-4 w-4" />
						)}
						{t("download.pasteUrlButton")}
					</Button>
				)}
			</div>
			<DialogContent
				className={cn(
					"flex max-h-[90vh] flex-col gap-0 overflow-hidden p-5 sm:max-w-xl",
					lockDialogHeight && "h-[90vh]",
				)}
			>
				<Tabs
					className="flex min-h-0 w-full flex-1 flex-col gap-0"
					defaultValue="single"
					onValueChange={(value) =>
						setActiveTab(value as "single" | "playlist")
					}
					value={activeTab}
				>
					<DialogHeader>
						<TabsList>
							<TabsTrigger
								onClick={() => setActiveTab("single")}
								value="single"
							>
								<Video className="h-3.5 w-3.5" />
								{t("download.singleVideo")}
							</TabsTrigger>
							<TabsTrigger
								onClick={() => setActiveTab("playlist")}
								value="playlist"
							>
								<List className="h-3.5 w-3.5" />
								{t("download.metadata.playlist")}
							</TabsTrigger>
						</TabsList>
					</DialogHeader>
					<TabsContent
						className="mt-0 flex min-h-0 flex-1 flex-col"
						value="single"
					>
						<SingleVideoDownload
							error={error}
							feedbackSourceUrl={url}
							loading={loading}
							onStateChange={handleSingleVideoStateChange}
							oneClickQuality={settings.oneClickQuality}
							state={singleVideoState}
							videoInfo={videoInfo}
						/>
					</TabsContent>

					<TabsContent
						className="mt-0 flex min-h-0 flex-1 flex-col"
						value="playlist"
					>
						<PlaylistDownload
							advancedOptionsOpen={advancedOptionsOpen}
							downloadType={downloadType}
							downloadTypeId={downloadTypeId}
							endIndex={endIndex}
							playlistBusy={playlistBusy}
							playlistInfo={playlistInfo}
							playlistPreviewError={playlistPreviewError}
							playlistPreviewLoading={playlistPreviewLoading}
							selectedEntryIds={selectedEntryIds}
							selectedPlaylistEntries={selectedPlaylistEntries}
							setDownloadType={setDownloadType}
							setEndIndex={setEndIndex}
							setSelectedEntryIds={setSelectedEntryIds}
							setStartIndex={setStartIndex}
							startIndex={startIndex}
						/>
					</TabsContent>
				</Tabs>
				<DialogFooter className="relative z-10 shrink-0 border-t bg-background pt-3">
					<div className="flex w-full items-center justify-between gap-3">
						<div className="flex items-center gap-3">
							{activeTab === "playlist" &&
								!playlistInfo &&
								!playlistPreviewLoading && (
									<div className="flex items-center gap-2">
										<Checkbox
											checked={advancedOptionsOpen}
											id={advancedOptionsId}
											onCheckedChange={(checked) => {
												setAdvancedOptionsOpen(checked === true);
											}}
										/>
										<Label
											className="cursor-pointer text-xs"
											htmlFor={advancedOptionsId}
										>
											{t("advancedOptions.title")}
										</Label>
									</div>
								)}

							{activeTab === "single" && !videoInfo && !loading && (
								<div className="relative w-[320px]">
									<Input
										className="h-8 pr-8 text-xs"
										onChange={(event) => setUrl(event.target.value)}
										placeholder={t("download.urlPlaceholder")}
										value={url}
									/>
									<div className="absolute top-1/2 right-1 -translate-y-1/2">
										<Button
											className="h-6 w-6"
											onClick={async () => {
												if (!navigator.clipboard?.readText) {
													return;
												}
												try {
													const clipboardText =
														await navigator.clipboard.readText();
													if (clipboardText.trim()) {
														setUrl(clipboardText.trim());
													}
												} catch {
													// ignore
												}
											}}
											size="icon"
											variant="ghost"
										>
											<FolderOpen className="h-3 w-3 text-muted-foreground" />
										</Button>
									</div>
								</div>
							)}
						</div>
						<div className="ml-auto flex gap-2">
							{activeTab === "single" ? (
								videoInfo || loading ? (
									!loading && videoInfo ? (
										<Button
											disabled={loading || !selectedSingleFormat}
											onClick={handleSingleVideoDownload}
										>
											{singleVideoState.activeTab === "video"
												? t("download.downloadVideo")
												: t("download.downloadAudio")}
										</Button>
									) : null
								) : (
									<Button
										disabled={loading || !url.trim()}
										onClick={
											settings.oneClickDownload
												? handleOneClickDownload
												: handleFetchVideo
										}
									>
										{settings.oneClickDownload
											? t("download.oneClickDownloadNow")
											: t("download.startDownload")}
									</Button>
								)
							) : playlistInfo && !playlistPreviewLoading ? (
								<Button
									disabled={
										playlistDownloadLoading ||
										selectedPlaylistEntries.length === 0
									}
									onClick={handleDownloadPlaylist}
								>
									{playlistDownloadLoading ? (
										<Loader2 className="mr-2 h-4 w-4 animate-spin" />
									) : (
										t("playlist.downloadCurrentRange")
									)}
								</Button>
							) : playlistPreviewLoading ? null : (
								<Button
									disabled={playlistBusy || !playlistUrl.trim()}
									onClick={handlePreviewPlaylist}
								>
									{playlistPreviewLoading ? (
										<Loader2 className="mr-2 h-4 w-4 animate-spin" />
									) : (
										t("download.startDownload")
									)}
								</Button>
							)}
						</div>
					</div>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
