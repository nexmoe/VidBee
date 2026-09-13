import type { VideoFormat, VideoInfo } from "@vidbee/downloader-core";
import { pickPreferredAudioFormatId } from "@vidbee/downloader-core/audio-format-preferences";
import { Button } from "@vidbee/ui/components/ui/button";
import {
	DOWNLOAD_FEEDBACK_ISSUE_TITLE,
	FeedbackLinkButtons,
} from "@vidbee/ui/components/ui/feedback-link-buttons";
import { Label } from "@vidbee/ui/components/ui/label";
import {
	RadioGroup,
	RadioGroupItem,
} from "@vidbee/ui/components/ui/radio-group";
import { RemoteImage } from "@vidbee/ui/components/ui/remote-image";
import { ScrollArea } from "@vidbee/ui/components/ui/scroll-area";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@vidbee/ui/components/ui/select";
import { TabItem, Tabs, TabsList } from "@vidbee/ui/components/ui/tabs";
import { TimeRangeOptions } from "@vidbee/ui/components/ui/time-range-options";
import { cn } from "@vidbee/ui/lib/cn";
import { AlertCircle, ExternalLink, Loader2, Settings2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { OneClickQualityPreset } from "../../lib/download-format-preferences";

export interface SingleVideoState {
	title: string;
	activeTab: "video" | "audio";
	selectedVideoFormat: string;
	selectedAudioFormat: string;
	startTime: string;
	endTime: string;
	selectedContainer?: string;
	selectedCodec?: string;
	selectedFps?: string;
}

interface SingleVideoDownloadProps {
	loading: boolean;
	error: string | null;
	videoInfo: VideoInfo | null;
	state: SingleVideoState;
	oneClickQuality: OneClickQualityPreset;
	preferredAudioLanguage?: string;
	feedbackSourceUrl?: string | null;
	onStateChange: (state: Partial<SingleVideoState>) => void;
}

const qualityPresetToVideoHeight: Record<OneClickQualityPreset, number | null> =
	{
		best: null,
		good: 1080,
		normal: 720,
		bad: 480,
		worst: 360,
	};

const formatDuration = (seconds?: number): string => {
	if (!seconds) {
		return "00:00";
	}
	const hours = Math.floor(seconds / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);
	const remainingSeconds = Math.floor(seconds % 60);
	if (hours > 0) {
		return `${hours}:${minutes.toString().padStart(2, "0")}:${remainingSeconds
			.toString()
			.padStart(2, "0")}`;
	}
	return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
};

const getCodecShortName = (codec?: string): string => {
	if (!codec || codec === "none") {
		return "Unknown";
	}
	return codec.split(".")[0].toUpperCase();
};

const isHlsFormat = (format: VideoFormat): boolean =>
	format.protocol === "m3u8" || format.protocol === "m3u8_native";

const isHttpProtocol = (format: VideoFormat): boolean =>
	Boolean(format.protocol?.startsWith("http"));

const filterFormatsByType = (
	formats: VideoInfo["formats"],
	activeTab: "video" | "audio",
): VideoInfo["formats"] => {
	if (!formats) {
		return [];
	}

	return formats.filter((format) => {
		if (activeTab === "video") {
			return format.vcodec && format.vcodec !== "none";
		}

		return (
			format.acodec &&
			format.acodec !== "none" &&
			(format.videoExt === "none" ||
				!format.videoExt ||
				!format.vcodec ||
				format.vcodec === "none")
		);
	});
};

interface FormatListProps {
	formats: VideoFormat[];
	type: "video" | "audio";
	codec?: string;
	selectedFormat: string;
	onFormatChange: (formatId: string) => void;
	oneClickQuality: OneClickQualityPreset;
	preferredAudioLanguage?: string;
}

const FormatList = ({
	formats,
	type,
	codec,
	selectedFormat,
	onFormatChange,
	oneClickQuality,
	preferredAudioLanguage,
}: FormatListProps) => {
	const { t } = useTranslation();
	const [videoFormats, setVideoFormats] = useState<VideoFormat[]>([]);
	const [audioFormats, setAudioFormats] = useState<VideoFormat[]>([]);

	const getFileSize = useCallback((format: VideoFormat): number => {
		return format.filesize ?? format.filesizeApprox ?? 0;
	}, []);

	const sortVideoFormatsByQuality = useCallback(
		(a: VideoFormat, b: VideoFormat) => {
			const aHeight = a.height ?? 0;
			const bHeight = b.height ?? 0;
			if (aHeight !== bHeight) {
				return bHeight - aHeight;
			}
			const aFps = a.fps ?? 0;
			const bFps = b.fps ?? 0;
			if (aFps !== bFps) {
				return bFps - aFps;
			}
			const aHasSize = !!(a.filesize || a.filesizeApprox);
			const bHasSize = !!(b.filesize || b.filesizeApprox);
			if (aHasSize !== bHasSize) {
				return bHasSize ? 1 : -1;
			}
			return getFileSize(b) - getFileSize(a);
		},
		[getFileSize],
	);

	const sortAudioFormatsByQuality = useCallback(
		(a: VideoFormat, b: VideoFormat) => {
			const aQuality = a.tbr ?? a.quality ?? 0;
			const bQuality = b.tbr ?? b.quality ?? 0;
			if (aQuality !== bQuality) {
				return bQuality - aQuality;
			}
			const aHasSize = !!(a.filesize || a.filesizeApprox);
			const bHasSize = !!(b.filesize || b.filesizeApprox);
			if (aHasSize !== bHasSize) {
				return bHasSize ? 1 : -1;
			}
			return getFileSize(b) - getFileSize(a);
		},
		[getFileSize],
	);

	const pickVideoFormatForPreset = useCallback(
		(
			presetFormats: VideoFormat[],
			preset: OneClickQualityPreset,
		): VideoFormat | null => {
			if (presetFormats.length === 0) {
				return null;
			}

			const heightLimit = qualityPresetToVideoHeight[preset];
			const sorted = [...presetFormats].sort(sortVideoFormatsByQuality);

			if (preset === "worst") {
				return sorted.at(-1) ?? sorted[0];
			}

			if (!heightLimit) {
				return sorted[0];
			}

			const matchingLimit = sorted.find((format) => {
				if (!format.height) {
					return false;
				}
				return format.height <= heightLimit;
			});

			return matchingLimit ?? sorted[0];
		},
		[sortVideoFormatsByQuality],
	);

	useEffect(() => {
		const isVideoFormat = (format: VideoFormat) =>
			format.videoExt !== "none" && format.vcodec && format.vcodec !== "none";
		const isAudioFormat = (format: VideoFormat) =>
			format.acodec &&
			format.acodec !== "none" &&
			(format.videoExt === "none" ||
				!format.videoExt ||
				!format.vcodec ||
				format.vcodec === "none");

		const videos = formats.filter(isVideoFormat);
		const audios = formats.filter(isAudioFormat);

		const groupedByHeight = new Map<number, VideoFormat[]>();
		videos.forEach((format) => {
			const height = format.height ?? 0;
			const existing = groupedByHeight.get(height) || [];
			existing.push(format);
			groupedByHeight.set(height, existing);
		});

		const finalVideos = Array.from(groupedByHeight.values()).map((group) => {
			return group.sort((a, b) => getFileSize(b) - getFileSize(a))[0];
		});

		let finalAudios = audios;

		if (codec === "auto" && type === "audio") {
			const groupedByQuality = new Map<string, VideoFormat[]>();
			audios.forEach((format) => {
				const qualityKey = format.tbr
					? `tbr_${format.tbr}`
					: format.quality
						? `quality_${format.quality}`
						: "unknown";
				const existing = groupedByQuality.get(qualityKey) || [];
				existing.push(format);
				groupedByQuality.set(qualityKey, existing);
			});

			finalAudios = Array.from(groupedByQuality.values()).map((group) => {
				return group.sort((a, b) => getFileSize(b) - getFileSize(a))[0];
			});
		}

		finalVideos.sort(sortVideoFormatsByQuality);
		finalAudios.sort(sortAudioFormatsByQuality);

		setVideoFormats(finalVideos);
		setAudioFormats(finalAudios);

		if (type === "video") {
			const videosWithAudio = finalVideos.filter(
				(format) => format.acodec && format.acodec !== "none",
			);
			const autoVideos =
				finalAudios.length > 0
					? finalVideos
					: videosWithAudio.length > 0
						? videosWithAudio
						: finalVideos;

			const hasSelectedVideo = finalVideos.some(
				(format) => format.formatId === selectedFormat,
			);
			if (autoVideos.length > 0 && !(selectedFormat && hasSelectedVideo)) {
				const preferred = pickVideoFormatForPreset(autoVideos, oneClickQuality);
				if (preferred) {
					onFormatChange(preferred.formatId);
				}
			}
		} else {
			const hasSelectedAudio = finalAudios.some(
				(format) => format.formatId === selectedFormat,
			);
			if (finalAudios.length > 0 && !(selectedFormat && hasSelectedAudio)) {
				const preferredFormatId = pickPreferredAudioFormatId(
					finalAudios,
					preferredAudioLanguage,
				);
				if (preferredFormatId) {
					onFormatChange(preferredFormatId);
				}
			}
		}
	}, [
		formats,
		oneClickQuality,
		type,
		selectedFormat,
		onFormatChange,
		pickVideoFormatForPreset,
		codec,
		preferredAudioLanguage,
		getFileSize,
		sortVideoFormatsByQuality,
		sortAudioFormatsByQuality,
	]);

	const formatSize = (bytes?: number) => {
		if (!bytes) {
			return t("download.unknownSize");
		}
		const mb = bytes / 1_000_000;
		if (mb < 0.1) {
			return `${Math.max(1, Math.round(bytes / 1000))} KB`;
		}
		if (mb < 10) {
			return `${mb.toFixed(1)} MB`;
		}
		return `${Math.round(mb)} MB`;
	};

	const formatVideoQuality = (format: VideoFormat) => {
		if (format.height) {
			return `${format.height}p`;
		}
		if (format.formatNote) {
			return format.formatNote;
		}
		if (typeof format.quality === "number") {
			return format.quality.toString();
		}
		return t("download.unknownQuality");
	};

	const formatAudioQuality = (format: VideoFormat) => {
		if (format.tbr) {
			return `${Math.round(format.tbr)} kbps`;
		}
		if (format.formatNote) {
			return format.formatNote;
		}
		if (typeof format.quality === "number") {
			return format.quality.toString();
		}
		return t("download.unknownQuality");
	};

	const formatVideoDetail = (format: VideoFormat) => {
		const parts: string[] = [];
		if (format.ext) {
			parts.push(format.ext.toUpperCase());
		}
		if (format.vcodec && format.vcodec !== "none") {
			parts.push(getCodecShortName(format.vcodec));
		}
		if (format.fps) {
			parts.push(`${format.fps} fps`);
		}
		return parts.join(" · ");
	};

	const formatAudioDetail = (format: VideoFormat) => {
		const ext = format.ext === "webm" ? "opus" : format.ext;
		const parts: string[] = [ext.toUpperCase()];
		if (format.acodec && format.acodec !== "none") {
			parts.push(getCodecShortName(format.acodec));
		}
		return parts.join(" · ");
	};

	const list = type === "video" ? videoFormats : audioFormats;

	if (list.length === 0) {
		return null;
	}

	return (
		<RadioGroup
			className="w-full gap-0.5"
			onValueChange={onFormatChange}
			value={selectedFormat}
		>
			{list.map((format) => {
				const qualityLabel =
					type === "video"
						? formatVideoQuality(format)
						: formatAudioQuality(format);
				const detailLabel =
					type === "video"
						? formatVideoDetail(format)
						: formatAudioDetail(format);
				const language = format.language?.trim();
				const sizeLabel = formatSize(format.filesize || format.filesizeApprox);
				const isSelected = selectedFormat === format.formatId;

				return (
					<label
						className={cn(
							"relative flex cursor-pointer items-center rounded-md px-2.5 py-1.5 transition-colors duration-150",
							isSelected ? "bg-primary/10" : "hover:bg-muted",
						)}
						htmlFor={`${type}-${format.formatId}`}
						key={format.formatId}
					>
						<RadioGroupItem
							className="hidden shrink-0"
							id={`${type}-${format.formatId}`}
							value={format.formatId}
						/>

						<div className="grid min-w-0 flex-1 grid-cols-[5.5rem_minmax(0,1fr)_4.5rem] items-center gap-3">
							<span
								className={cn(
									"font-medium text-sm tabular-nums",
									isSelected && "text-primary",
								)}
							>
								{qualityLabel}
							</span>

							<div className="flex min-w-0 items-center gap-1.5">
								<span className="truncate text-muted-foreground text-xs">
									{detailLabel}
								</span>
								{language && (
									<span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-medium text-[10px] text-muted-foreground uppercase">
										{language}
									</span>
								)}
							</div>

							<span className="text-right text-muted-foreground text-xs tabular-nums">
								{sizeLabel}
							</span>
						</div>
					</label>
				);
			})}
		</RadioGroup>
	);
};

export function SingleVideoDownload({
	loading,
	error,
	videoInfo,
	state,
	oneClickQuality,
	preferredAudioLanguage,
	feedbackSourceUrl,
	onStateChange,
}: SingleVideoDownloadProps) {
	const { t } = useTranslation();
	const [showAdvanced, setShowAdvanced] = useState(false);

	const {
		title,
		activeTab,
		selectedContainer,
		selectedCodec,
		selectedFps,
		startTime,
		endTime,
	} = state;
	const displayTitle =
		title || videoInfo?.title || t("download.fetchingVideoInfo");

	const relevantFormats = useMemo(() => {
		if (!videoInfo?.formats) {
			return [];
		}
		const baseFormats = filterFormatsByType(videoInfo.formats, activeTab);
		if (baseFormats.length === 0) {
			return [];
		}

		const hasHttpFormats = baseFormats.some(isHttpProtocol);
		if (!hasHttpFormats) {
			return baseFormats;
		}

		const nonHlsFormats = baseFormats.filter((format) => !isHlsFormat(format));
		return nonHlsFormats.length > 0 ? nonHlsFormats : baseFormats;
	}, [videoInfo?.formats, activeTab]);

	const containers = useMemo(() => {
		if (relevantFormats.length === 0) {
			return [];
		}
		const exts = new Set(relevantFormats.map((format) => format.ext));
		return Array.from(exts).sort();
	}, [relevantFormats]);

	useEffect(() => {
		if (containers.length === 0) {
			return undefined;
		}

		if (selectedContainer && !containers.includes(selectedContainer)) {
			let defaultContainer: string;
			if (activeTab === "video") {
				defaultContainer = containers.includes("mp4") ? "mp4" : containers[0];
			} else {
				defaultContainer = containers.includes("m4a")
					? "m4a"
					: containers.includes("mp3")
						? "mp3"
						: containers[0];
			}
			const timer = setTimeout(() => {
				onStateChange({
					selectedContainer: defaultContainer,
					selectedCodec: "auto",
				});
			}, 0);
			return () => clearTimeout(timer);
		}

		if (!selectedContainer) {
			let defaultContainer: string;
			if (activeTab === "video") {
				defaultContainer = containers.includes("mp4") ? "mp4" : containers[0];
			} else {
				defaultContainer = containers.includes("m4a")
					? "m4a"
					: containers.includes("mp3")
						? "mp3"
						: containers[0];
			}
			const timer = setTimeout(() => {
				onStateChange({ selectedContainer: defaultContainer });
			}, 0);
			return () => clearTimeout(timer);
		}

		return undefined;
	}, [containers, selectedContainer, activeTab, onStateChange]);

	const formatsByContainer = useMemo(() => {
		if (relevantFormats.length === 0) {
			return [];
		}

		if (!selectedContainer) {
			return relevantFormats;
		}

		return relevantFormats.filter((format) => format.ext === selectedContainer);
	}, [relevantFormats, selectedContainer]);

	const codecs = useMemo(() => {
		if (formatsByContainer.length === 0) {
			return [];
		}

		const setVals = new Set<string>();
		formatsByContainer.forEach((format) => {
			if (activeTab === "video") {
				const codec = format.vcodec;
				if (codec && codec !== "none") {
					setVals.add(getCodecShortName(codec));
				}
			} else {
				const codec = format.acodec;
				if (codec && codec !== "none") {
					setVals.add(getCodecShortName(codec));
				}
			}
		});
		return Array.from(setVals).sort();
	}, [formatsByContainer, activeTab]);

	useEffect(() => {
		if (codecs.length === 0) {
			return undefined;
		}
		if (
			selectedCodec &&
			selectedCodec !== "auto" &&
			!codecs.includes(selectedCodec)
		) {
			const timer = setTimeout(() => {
				onStateChange({ selectedCodec: "auto" });
			}, 0);
			return () => clearTimeout(timer);
		}
		return undefined;
	}, [codecs, selectedCodec, onStateChange]);

	const formatsByCodec = useMemo(() => {
		if (!selectedCodec || selectedCodec === "auto") {
			return formatsByContainer;
		}
		return formatsByContainer.filter((format) => {
			if (activeTab === "video") {
				const codec = format.vcodec;
				return (
					codec &&
					codec !== "none" &&
					getCodecShortName(codec) === selectedCodec
				);
			}
			const codec = format.acodec;
			return (
				codec && codec !== "none" && getCodecShortName(codec) === selectedCodec
			);
		});
	}, [formatsByContainer, selectedCodec, activeTab]);

	const framerates = useMemo(() => {
		if (activeTab !== "video") {
			return [];
		}
		const setVals = new Set<number>();
		formatsByCodec.forEach((format) => {
			if (format.fps) {
				setVals.add(format.fps);
			}
		});
		return Array.from(setVals).sort((a, b) => b - a);
	}, [formatsByCodec, activeTab]);

	const filteredFormats = useMemo(() => {
		let result = formatsByCodec;
		if (activeTab === "video" && selectedFps && selectedFps !== "highest") {
			result = result.filter((format) => format.fps === Number(selectedFps));
		}
		return result;
	}, [formatsByCodec, selectedFps, activeTab]);

	const hasParseResult = Boolean(loading || error || videoInfo);

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			{!hasParseResult && (
				<div className="flex min-h-[140px] flex-col items-center justify-center rounded-md border border-border/70 border-dashed bg-muted/20 px-6 text-center">
					<p className="text-muted-foreground text-sm">
						{t("download.enterUrl")}
					</p>
				</div>
			)}

			{loading && !error && (
				<div className="flex min-h-[140px] flex-col items-center justify-center gap-3 rounded-md border border-border/70 border-dashed bg-muted/20">
					<Loader2 className="h-8 w-8 animate-spin text-primary" />
					<p className="text-muted-foreground text-sm">
						{t("download.fetchingVideoInfo")}
					</p>
				</div>
			)}

			{error && (
				<div className="mb-3 shrink-0 rounded-md border border-destructive/30 bg-destructive/5 p-3">
					<div className="flex items-start gap-2">
						<AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
						<div className="min-w-0 flex-1 space-y-1">
							<p className="font-medium text-destructive text-sm">
								{t("errors.fetchInfoFailed")}
							</p>
							<p className="break-words text-muted-foreground/80 text-xs">
								{error}
							</p>
						</div>
					</div>
					<div className="mt-2.5 flex flex-wrap items-center gap-1.5">
						<span className="font-medium text-[10px] text-muted-foreground/70">
							{t("download.feedback.title")}
						</span>
						<div className="flex flex-wrap gap-1.5">
							<FeedbackLinkButtons
								buttonClassName="h-5 gap-1 px-1.5 text-[10px]"
								buttonSize="sm"
								buttonVariant="outline"
								error={error}
								iconClassName="h-2.5 w-2.5"
								issueTitle={DOWNLOAD_FEEDBACK_ISSUE_TITLE}
								sourceUrl={feedbackSourceUrl}
							/>
						</div>
					</div>
				</div>
			)}

			{!loading && videoInfo && (
				<div className="flex min-h-0 flex-1 flex-col gap-3">
					<div className="flex shrink-0 items-center gap-2.5 rounded-md border border-border/70 border-dashed bg-muted/20 p-2">
						<div className="relative aspect-video w-24 shrink-0 overflow-hidden rounded-md bg-muted">
							<RemoteImage
								alt={displayTitle}
								className="aspect-video h-full w-full object-cover"
								src={videoInfo.thumbnail}
							/>
							<div className="absolute right-1 bottom-1 rounded bg-black/80 px-1 text-[10px] text-white tabular-nums">
								{formatDuration(videoInfo.duration)}
							</div>
						</div>

						<div className="min-w-0 flex-1">
							<h3 className="line-clamp-2 font-medium text-sm leading-snug">
								{displayTitle}
							</h3>
							<div className="flex min-w-0 items-center gap-1.5 text-muted-foreground text-xs">
								{videoInfo.uploader && (
									<span className="truncate">{videoInfo.uploader}</span>
								)}
								{videoInfo.webpageUrl && (
									<a
										aria-label={t("download.metadata.source")}
										className="shrink-0 transition-colors hover:text-foreground"
										href={videoInfo.webpageUrl}
										rel="noreferrer"
										target="_blank"
									>
										<ExternalLink className="h-3 w-3" />
									</a>
								)}
							</div>
						</div>
					</div>

					<div className="flex min-h-0 flex-1 flex-col overflow-hidden">
						<div className="flex shrink-0 items-center gap-1.5">
							<Tabs
								onValueChange={(value) =>
									onStateChange({ activeTab: value as "video" | "audio" })
								}
								size="compact"
								value={activeTab}
							>
								<TabsList className="rounded-md [&>div]:rounded-md">
									<TabItem label={t("download.video")} value="video" />
									<TabItem label={t("download.audio")} value="audio" />
								</TabsList>
							</Tabs>

							<Button
								aria-label={t("advancedOptions.title")}
								aria-pressed={showAdvanced}
								className={cn(
									"h-7 w-7 shrink-0 rounded-md bg-muted p-0 text-muted-foreground transition-colors duration-150",
									showAdvanced && "text-foreground",
								)}
								onClick={() => setShowAdvanced(!showAdvanced)}
								size="sm"
								title={t("advancedOptions.title")}
								variant="ghost"
							>
								<Settings2 className="h-3.5 w-3.5" />
							</Button>
						</div>

						<div
							className={cn(
								"grid transition-[grid-template-rows] duration-200 ease-out",
								showAdvanced ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
							)}
						>
							<div className="min-h-0 overflow-hidden">
								<div className="mt-3 space-y-3 rounded-md bg-muted/40 p-3">
									<div
										className={cn(
											"grid gap-2",
											activeTab === "video" ? "grid-cols-3" : "grid-cols-2",
										)}
									>
										<div className="min-w-0 space-y-1">
											<Label
												className="font-medium text-muted-foreground text-xs"
												htmlFor="download-filter-container"
											>
												{t("download.metadata.format")}
											</Label>
											<Select
												disabled={containers.length <= 1}
												onValueChange={(value) =>
													onStateChange({ selectedContainer: value })
												}
												value={selectedContainer || ""}
											>
												<SelectTrigger
													className="h-7 text-xs"
													id="download-filter-container"
												>
													<SelectValue
														placeholder={t("download.metadata.format")}
													/>
												</SelectTrigger>
												<SelectContent>
													{containers.map((ext) => (
														<SelectItem
															className="text-xs"
															key={ext}
															value={ext}
														>
															{ext.toUpperCase()}
														</SelectItem>
													))}
												</SelectContent>
											</Select>
										</div>

										<div className="min-w-0 space-y-1">
											<Label
												className="font-medium text-muted-foreground text-xs"
												htmlFor="download-filter-codec"
											>
												{t("download.metadata.codec")}
											</Label>
											<Select
												disabled={codecs.length <= 1}
												onValueChange={(value) =>
													onStateChange({ selectedCodec: value })
												}
												value={selectedCodec || "auto"}
											>
												<SelectTrigger
													className="h-7 text-xs"
													id="download-filter-codec"
												>
													<SelectValue placeholder={t("download.codecAuto")} />
												</SelectTrigger>
												<SelectContent>
													<SelectItem className="text-xs" value="auto">
														{t("download.codecAuto")}
													</SelectItem>
													{codecs.map((codecName) => (
														<SelectItem
															className="text-xs"
															key={codecName}
															value={codecName}
														>
															{codecName}
														</SelectItem>
													))}
												</SelectContent>
											</Select>
										</div>

										{activeTab === "video" && (
											<div className="min-w-0 space-y-1">
												<Label
													className="font-medium text-muted-foreground text-xs"
													htmlFor="download-filter-fps"
												>
													{t("download.frameRate")}
												</Label>
												<Select
													disabled={framerates.length === 0}
													onValueChange={(value) =>
														onStateChange({ selectedFps: value })
													}
													value={selectedFps || "highest"}
												>
													<SelectTrigger
														className="h-7 text-xs"
														id="download-filter-fps"
													>
														<SelectValue
															placeholder={t("download.fpsHighest")}
														/>
													</SelectTrigger>
													<SelectContent>
														<SelectItem className="text-xs" value="highest">
															{t("download.fpsHighest")}
														</SelectItem>
														{framerates.map((fps) => (
															<SelectItem
																className="text-xs"
																key={fps}
																value={String(fps)}
															>
																{fps} fps
															</SelectItem>
														))}
													</SelectContent>
												</Select>
											</div>
										)}
									</div>
									<TimeRangeOptions
										endTime={endTime}
										onEndTimeChange={(value) =>
											onStateChange({ endTime: value })
										}
										onStartTimeChange={(value) =>
											onStateChange({ startTime: value })
										}
										startTime={startTime}
									/>
								</div>
							</div>
						</div>

						<ScrollArea className="mt-2 max-h-72 flex-1 overflow-y-auto">
							<FormatList
								codec={selectedCodec}
								formats={filteredFormats}
								onFormatChange={(formatId) =>
									onStateChange(
										activeTab === "video"
											? { selectedVideoFormat: formatId }
											: { selectedAudioFormat: formatId },
									)
								}
								oneClickQuality={oneClickQuality}
								preferredAudioLanguage={preferredAudioLanguage}
								selectedFormat={
									activeTab === "video"
										? state.selectedVideoFormat
										: state.selectedAudioFormat
								}
								type={activeTab}
							/>
						</ScrollArea>
					</div>
				</div>
			)}
		</div>
	);
}
