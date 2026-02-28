import {
	buildFilePathCandidates,
	normalizeSavedFileName,
} from "@vidbee/downloader-core/download-file";
import { Badge } from "@vidbee/ui/components/ui/badge";
import { Button } from "@vidbee/ui/components/ui/button";
import { Checkbox } from "@vidbee/ui/components/ui/checkbox";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuTrigger,
} from "@vidbee/ui/components/ui/context-menu";
import {
	DOWNLOAD_FEEDBACK_ISSUE_TITLE,
	FeedbackLinkButtons,
} from "@vidbee/ui/components/ui/feedback-link-buttons";
import { Progress } from "@vidbee/ui/components/ui/progress";
import { RemoteImage } from "@vidbee/ui/components/ui/remote-image";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from "@vidbee/ui/components/ui/sheet";
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
import {
	AlertCircle,
	CheckCircle2,
	Copy,
	File,
	FolderOpen,
	Loader2,
	RotateCw,
	Trash2,
	X,
} from "lucide-react";
import {
	type KeyboardEvent,
	type ReactNode,
	useEffect,
	useRef,
	useState,
} from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { orpcClient } from "../../lib/orpc-client";
import { resolveImageProxyUrl } from "../../lib/remote-image-proxy";
import { readWebSettings } from "../../lib/web-settings";
import type { DownloadRecord } from "./types";

interface DownloadItemProps {
	download: DownloadRecord;
	isSelected?: boolean;
	onToggleSelect?: (id: string) => void;
	onCancel?: (id: string) => void;
	onRetry?: (download: DownloadRecord) => void;
	onRemove?: (id: string) => void;
	onCopyUrl?: (url: string) => void;
}

interface MetadataDetail {
	label: string;
	value: ReactNode;
}

const formatFileSize = (bytes?: number) => {
	if (!bytes) {
		return "";
	}
	const sizes = ["B", "KB", "MB", "GB"];
	const order = Math.min(
		Math.floor(Math.log(bytes) / Math.log(1024)),
		sizes.length - 1,
	);
	return `${(bytes / 1024 ** order).toFixed(1)} ${sizes[order]}`;
};

const formatDuration = (seconds?: number) => {
	if (!seconds) {
		return "";
	}
	const h = Math.floor(seconds / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	const s = Math.floor(seconds % 60);

	if (h > 0) {
		return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
	}

	return `${m}:${s.toString().padStart(2, "0")}`;
};

const formatDate = (timestamp?: number) => {
	if (!timestamp) {
		return "";
	}
	return new Date(timestamp).toLocaleString();
};

const formatDateShort = (timestamp?: number) => {
	if (!timestamp) {
		return "";
	}
	const date = new Date(timestamp);
	return date.toLocaleString(undefined, {
		month: "numeric",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
};

const getQualityLabel = (download: DownloadRecord): string | undefined => {
	const format = download.selectedFormat;
	if (!format) {
		return undefined;
	}
	if (format.height) {
		return `${format.height}p${format.fps === 60 ? "60" : ""}`;
	}
	if (format.formatNote) {
		return format.formatNote;
	}
	if (typeof format.quality === "number") {
		return format.quality.toString();
	}
	return undefined;
};

const getFormatLabel = (download: DownloadRecord): string | undefined => {
	if (download.selectedFormat?.ext) {
		return download.selectedFormat.ext.toUpperCase();
	}
	const savedExt = normalizeSavedFileName(download.savedFileName)
		?.split(".")
		.pop()
		?.toUpperCase();
	return savedExt;
};

const sanitizeCodec = (codec?: string | null): string | undefined => {
	if (!codec || codec === "none") {
		return undefined;
	}
	return codec;
};

const getCodecLabel = (download: DownloadRecord): string | undefined => {
	const format = download.selectedFormat;
	if (!format) {
		return undefined;
	}
	if (download.type === "audio") {
		return sanitizeCodec(format.acodec);
	}
	return sanitizeCodec(format.vcodec) ?? sanitizeCodec(format.acodec);
};

const getStatusText = (
	status: DownloadRecord["status"],
	t: (key: string) => string,
): string => {
	switch (status) {
		case "completed":
			return t("download.completed");
		case "error":
			return t("download.error");
		case "downloading":
			return t("download.downloading");
		case "processing":
			return t("download.processing");
		case "pending":
			return t("download.downloadPending");
		case "cancelled":
			return t("download.cancelled");
		default:
			return "";
	}
};

const getStatusIcon = (status: DownloadRecord["status"]) => {
	switch (status) {
		case "completed":
			return <CheckCircle2 className="h-4 w-4 text-green-500" />;
		case "error":
			return <AlertCircle className="h-4 w-4 text-destructive" />;
		case "downloading":
		case "processing":
			return <Loader2 className="h-4 w-4 animate-spin text-primary" />;
		case "pending":
			return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />;
		case "cancelled":
			return <X className="h-4 w-4 text-muted-foreground" />;
		default:
			return null;
	}
};

const isActiveStatus = (status: DownloadRecord["status"]): boolean =>
	status === "downloading" || status === "processing" || status === "pending";

const resolveDownloadExtension = (download: DownloadRecord): string => {
	const savedExt = normalizeSavedFileName(download.savedFileName)
		?.split(".")
		.pop();
	if (savedExt) {
		return savedExt.toLowerCase();
	}
	const selectedExt = download.selectedFormat?.ext?.toLowerCase();
	if (selectedExt) {
		return selectedExt;
	}
	return download.type === "audio" ? "mp3" : "mp4";
};

export function DownloadItem({
	download,
	isSelected = false,
	onToggleSelect,
	onCancel,
	onRetry,
	onRemove,
	onCopyUrl,
}: DownloadItemProps) {
	const { t } = useTranslation();
	const isHistory = download.entryType === "history";
	const timestamp =
		download.completedAt ?? download.startedAt ?? download.createdAt;
	const qualityLabel = getQualityLabel(download);
	const statusIcon = getStatusIcon(download.status);
	const statusText = getStatusText(download.status, t);
	const resolvedExtension = resolveDownloadExtension(download);

	const [fileExists, setFileExists] = useState(false);
	const [resolvedFilePath, setResolvedFilePath] = useState<string | null>(null);
	const [sheetOpen, setSheetOpen] = useState(false);
	const [activeTab, setActiveTab] = useState<"details" | "logs">("details");
	const [pendingTab, setPendingTab] = useState<"details" | "logs" | null>(null);
	const [logAutoScroll, setLogAutoScroll] = useState(true);
	const [isContextMenuOpen, setIsContextMenuOpen] = useState(false);

	const logContainerRef = useRef<HTMLDivElement | null>(null);
	const lastSheetOpenRef = useRef(false);

	const getEffectiveDownloadPath = (): string => {
		const rowPath = download.downloadPath?.trim();
		if (rowPath) {
			return rowPath;
		}
		return readWebSettings().downloadPath.trim();
	};

	const getFilePathCandidates = (): string[] => {
		const downloadPath = getEffectiveDownloadPath();
		if (!downloadPath) {
			return [];
		}
		return buildFilePathCandidates(
			downloadPath,
			download.title ?? "",
			resolvedExtension,
			download.savedFileName,
		);
	};

	const findExistingFilePath = async (): Promise<string | null> => {
		const candidates = getFilePathCandidates();
		for (const filePath of candidates) {
			try {
				const result = await orpcClient.files.exists({ path: filePath });
				if (result.exists) {
					return filePath;
				}
			} catch {}
		}
		return null;
	};

	const tryFileOperation = async (
		operation: (filePath: string) => Promise<boolean>,
	): Promise<{ filePath?: string; success: boolean }> => {
		const seen = new Set<string>();
		const orderedCandidates = [
			resolvedFilePath,
			...getFilePathCandidates(),
		].filter((filePath): filePath is string => {
			if (!filePath) {
				return false;
			}
			if (seen.has(filePath)) {
				return false;
			}
			seen.add(filePath);
			return true;
		});

		for (const filePath of orderedCandidates) {
			try {
				const success = await operation(filePath);
				if (success) {
					return { success: true, filePath };
				}
			} catch {}
		}

		return { success: false };
	};

	useEffect(() => {
		let isMounted = true;

		const checkFileExists = async () => {
			const downloadPath =
				download.downloadPath?.trim() || readWebSettings().downloadPath.trim();
			if (!downloadPath) {
				if (!isMounted) {
					return;
				}
				setFileExists(false);
				setResolvedFilePath(null);
				return;
			}

			const candidates = buildFilePathCandidates(
				downloadPath,
				download.title ?? "",
				resolvedExtension,
				download.savedFileName,
			);

			let existingFilePath: string | null = null;
			for (const filePath of candidates) {
				try {
					const result = await orpcClient.files.exists({ path: filePath });
					if (result.exists) {
						existingFilePath = filePath;
						break;
					}
				} catch {}
			}

			if (!isMounted) {
				return;
			}
			setFileExists(Boolean(existingFilePath));
			setResolvedFilePath(existingFilePath);
		};

		void checkFileExists();

		return () => {
			isMounted = false;
		};
	}, [
		download.title,
		download.downloadPath,
		download.savedFileName,
		resolvedExtension,
	]);

	const handleCancel = () => {
		onCancel?.(download.id);
	};

	const handleRetryDownload = () => {
		onRetry?.(download);
	};

	const handleOpenFolder = async () => {
		const result = await tryFileOperation(async (filePath) => {
			const response = await orpcClient.files.openFileLocation({
				path: filePath,
			});
			return response.success;
		});

		if (!result.success) {
			toast.error(t("notifications.openFolderFailed"));
			return;
		}

		setResolvedFilePath(result.filePath ?? null);
		setFileExists(true);
	};

	const handleOpenFile = async () => {
		const result = await tryFileOperation(async (filePath) => {
			const response = await orpcClient.files.openFile({ path: filePath });
			return response.success;
		});

		if (!result.success) {
			toast.error(t("notifications.openFileFailed"));
			return;
		}

		setResolvedFilePath(result.filePath ?? null);
		setFileExists(true);
	};

	const handleCopyLink = async () => {
		if (!download.url?.trim()) {
			toast.error(t("notifications.copyFailed"));
			return;
		}

		if (onCopyUrl) {
			onCopyUrl(download.url);
			return;
		}

		if (!navigator.clipboard?.writeText) {
			toast.error(t("notifications.copyFailed"));
			return;
		}

		try {
			await navigator.clipboard.writeText(download.url);
			toast.success(t("notifications.urlCopied"));
		} catch {
			toast.error(t("notifications.copyFailed"));
		}
	};

	const handleCopyToClipboard = async () => {
		const currentPath = resolvedFilePath ?? (await findExistingFilePath());
		if (!currentPath) {
			toast.error(t("notifications.copyFailed"));
			return;
		}

		try {
			const response = await orpcClient.files.copyFileToClipboard({
				path: currentPath,
			});
			if (!response.success) {
				if (!navigator.clipboard?.writeText) {
					toast.error(t("notifications.copyFailed"));
					return;
				}
				await navigator.clipboard.writeText(currentPath);
			}
			setResolvedFilePath(currentPath);
			setFileExists(true);
			toast.success(t("notifications.videoCopied"));
		} catch {
			toast.error(t("notifications.copyFailed"));
		}
	};

	const handleDeleteFile = async () => {
		const result = await tryFileOperation(async (filePath) => {
			const response = await orpcClient.files.deleteFile({ path: filePath });
			return response.success;
		});

		if (!result.success) {
			toast.error(t("notifications.removeFailed"));
			return;
		}

		setFileExists(false);
		setResolvedFilePath(null);
		onRemove?.(download.id);
	};

	const handleDeleteRecord = () => {
		onRemove?.(download.id);
	};

	const selectedFormatSize =
		download.selectedFormat?.filesize ??
		download.selectedFormat?.filesizeApprox;
	const inlineFileSize = selectedFormatSize
		? formatFileSize(selectedFormatSize)
		: undefined;

	const isInProgressStatus = isActiveStatus(download.status);
	const isCompletedStatus = download.status === "completed";
	const canRetry = download.status === "error";
	const showCopyAction = isCompletedStatus && fileExists;
	const showOpenFolderAction = Boolean(
		download.title && getEffectiveDownloadPath().trim(),
	);
	const canCopyLink = Boolean(download.url);
	const canOpenFile = isCompletedStatus && fileExists;
	const canDeleteFile = isCompletedStatus && fileExists;
	const canDeleteRecord = Boolean(onRemove);
	const isSelectedHistory = isHistory && Boolean(onToggleSelect) && isSelected;

	const sourceDisplay =
		download.uploader &&
		download.channel &&
		download.uploader !== download.channel
			? `${download.uploader} • ${download.channel}`
			: download.uploader || download.channel || "";

	const metadataDetails: MetadataDetail[] = [];
	if (timestamp) {
		metadataDetails.push({
			label: t("history.date"),
			value: formatDate(timestamp),
		});
	}
	if (sourceDisplay) {
		metadataDetails.push({
			label: t("download.metadata.source"),
			value: sourceDisplay,
		});
	}
	if (download.playlistId) {
		metadataDetails.push({
			label: t("download.metadata.playlist"),
			value: (
				<span>
					{download.playlistTitle || t("playlist.untitled")}
					{download.playlistIndex !== undefined &&
					download.playlistSize !== undefined ? (
						<span className="text-muted-foreground/80">
							{` ${t("playlist.positionLabel", {
								index: download.playlistIndex,
								total: download.playlistSize,
							})}`}
						</span>
					) : null}
				</span>
			),
		});
	}
	if (download.duration) {
		metadataDetails.push({
			label: t("history.duration"),
			value: formatDuration(download.duration),
		});
	}

	const formatLabelValue = getFormatLabel(download);
	if (formatLabelValue) {
		metadataDetails.push({
			label: t("download.metadata.format"),
			value: formatLabelValue,
		});
	}
	if (qualityLabel) {
		metadataDetails.push({
			label: t("download.metadata.quality"),
			value: qualityLabel,
		});
	}
	if (inlineFileSize) {
		metadataDetails.push({
			label: t("history.fileSize"),
			value: inlineFileSize,
		});
	}
	const codecValue = getCodecLabel(download);
	if (codecValue) {
		metadataDetails.push({
			label: t("download.metadata.codec"),
			value: codecValue,
		});
	}
	const normalizedSavedFileName = normalizeSavedFileName(
		download.savedFileName,
	);
	if (normalizedSavedFileName || download.savedFileName) {
		metadataDetails.push({
			label: t("download.metadata.savedFile"),
			value: normalizedSavedFileName ?? download.savedFileName ?? "",
		});
	}
	if (download.url) {
		metadataDetails.push({
			label: t("download.metadata.url"),
			value: (
				<a
					className="break-words text-primary hover:underline"
					href={download.url}
					rel="noopener noreferrer"
					target="_blank"
				>
					{download.url}
				</a>
			),
		});
	}
	if (download.description) {
		metadataDetails.push({
			label: t("download.metadata.description"),
			value: <span className="break-words">{download.description}</span>,
		});
	}
	if (download.viewCount !== undefined && download.viewCount !== null) {
		metadataDetails.push({
			label: t("download.metadata.views"),
			value: download.viewCount.toLocaleString(),
		});
	}
	if (download.tags && download.tags.length > 0) {
		metadataDetails.push({
			label: t("download.metadata.tags"),
			value: (
				<div className="flex flex-wrap gap-1">
					{download.tags.map((tag) => (
						<Badge
							className="px-1.5 py-0.5 text-[10px]"
							key={tag}
							variant="secondary"
						>
							{tag}
						</Badge>
					))}
				</div>
			),
		});
	}
	if (download.downloadPath) {
		metadataDetails.push({
			label: t("download.metadata.downloadPath"),
			value: (
				<span className="break-words font-mono text-xs">
					{download.downloadPath}
				</span>
			),
		});
	}
	if (download.createdAt && download.createdAt !== timestamp) {
		metadataDetails.push({
			label: t("download.metadata.createdAt"),
			value: formatDate(download.createdAt),
		});
	}
	if (download.startedAt) {
		metadataDetails.push({
			label: t("download.metadata.startedAt"),
			value: formatDate(download.startedAt),
		});
	}
	if (download.completedAt && download.completedAt !== timestamp) {
		metadataDetails.push({
			label: t("download.metadata.completedAt"),
			value: formatDate(download.completedAt),
		});
	}
	if (download.speed) {
		metadataDetails.push({
			label: t("download.metadata.speed"),
			value: download.speed,
		});
	}
	if (download.fileSize && download.fileSize !== selectedFormatSize) {
		metadataDetails.push({
			label: t("download.metadata.fileSize"),
			value: formatFileSize(download.fileSize),
		});
	}
	if (download.selectedFormat) {
		if (download.selectedFormat.width) {
			metadataDetails.push({
				label: t("download.metadata.width"),
				value: `${download.selectedFormat.width}px`,
			});
		}
		if (download.selectedFormat.height && !qualityLabel) {
			metadataDetails.push({
				label: t("download.metadata.height"),
				value: `${download.selectedFormat.height}px`,
			});
		}
		if (download.selectedFormat.fps) {
			metadataDetails.push({
				label: t("download.metadata.fps"),
				value: `${download.selectedFormat.fps}`,
			});
		}
		if (download.selectedFormat.vcodec) {
			metadataDetails.push({
				label: t("download.metadata.videoCodec"),
				value: download.selectedFormat.vcodec,
			});
		}
		if (download.selectedFormat.acodec) {
			metadataDetails.push({
				label: t("download.metadata.audioCodec"),
				value: download.selectedFormat.acodec,
			});
		}
		if (download.selectedFormat.formatNote) {
			metadataDetails.push({
				label: t("download.metadata.formatNote"),
				value: download.selectedFormat.formatNote,
			});
		}
		if (download.selectedFormat.protocol) {
			metadataDetails.push({
				label: t("download.metadata.protocol"),
				value: download.selectedFormat.protocol.toUpperCase(),
			});
		}
	}

	const hasMetadataDetails = metadataDetails.length > 0;
	const logContent = download.ytDlpLog ?? "";
	const hasLogContent = logContent.trim().length > 0;
	const ytDlpCommand = download.ytDlpCommand?.trim();
	const hasYtDlpCommand = Boolean(ytDlpCommand);
	const canShowSheet =
		hasMetadataDetails ||
		isInProgressStatus ||
		hasLogContent ||
		hasYtDlpCommand;

	useEffect(() => {
		const wasOpen = lastSheetOpenRef.current;
		lastSheetOpenRef.current = sheetOpen;
		if (!sheetOpen || wasOpen) {
			return;
		}
		const defaultTab = hasMetadataDetails ? "details" : "logs";
		setActiveTab(pendingTab ?? defaultTab);
		setPendingTab(null);
		setLogAutoScroll(true);
	}, [hasMetadataDetails, pendingTab, sheetOpen]);

	useEffect(() => {
		if (!(sheetOpen && logAutoScroll && logContent)) {
			return;
		}
		const container = logContainerRef.current;
		if (container) {
			container.scrollTop = container.scrollHeight;
		}
	}, [logAutoScroll, logContent, sheetOpen]);

	const handleLogScroll = () => {
		const container = logContainerRef.current;
		if (!container) {
			return;
		}
		const { scrollTop, scrollHeight, clientHeight } = container;
		const isNearBottom = scrollHeight - scrollTop - clientHeight < 24;
		setLogAutoScroll(isNearBottom);
	};

	const openLogsSheet = () => {
		if (!canShowSheet) {
			return;
		}
		setPendingTab(sheetOpen ? null : "logs");
		setActiveTab("logs");
		setLogAutoScroll(true);
		setSheetOpen(true);
	};

	const handleSelectKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		if (!onToggleSelect) {
			return;
		}
		if (event.key === "Enter" || event.key === " ") {
			event.preventDefault();
			onToggleSelect(download.id);
		}
	};

	return (
		<ContextMenu onOpenChange={setIsContextMenuOpen}>
			<ContextMenuTrigger asChild>
				<div
					className={`group relative w-full max-w-full overflow-hidden px-6 py-2 transition-colors ${
						isSelectedHistory || isContextMenuOpen ? "bg-primary/10" : ""
					}`}
				>
					<div
						className={`flex w-full flex-col gap-2 sm:flex-row sm:gap-3 ${
							isHistory && onToggleSelect ? "cursor-pointer" : ""
						}`}
						{...(isHistory && onToggleSelect
							? {
									onClick: () => onToggleSelect(download.id),
									onKeyDown: handleSelectKeyDown,
									role: "button",
									tabIndex: 0,
									"aria-label": t("history.selectItem"),
								}
							: {})}
					>
						<div className="relative z-20 flex h-14 w-24 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border/60 bg-background/60">
							{isHistory && onToggleSelect && (
								<div
									className={`absolute top-1 left-1 z-30 rounded-md transition ${
										isSelected
											? "opacity-100"
											: "opacity-0 group-focus-within:opacity-100 group-hover:opacity-100"
									}`}
								>
									<Checkbox
										aria-label={t("history.selectItem")}
										checked={Boolean(isSelected)}
										onCheckedChange={() => onToggleSelect(download.id)}
										onClick={(event) => event.stopPropagation()}
									/>
								</div>
							)}
							<RemoteImage
								alt={download.title || download.id}
								cacheResolver={resolveImageProxyUrl}
								className="h-full w-full object-cover"
								src={download.thumbnail}
							/>
						</div>

						<div className="min-w-0 max-w-full flex-1 overflow-hidden">
							<div className="flex h-14 w-full flex-col justify-center gap-1.5 sm:flex-row sm:items-center sm:justify-between sm:gap-2">
								<div className="min-w-0 max-w-full flex-1 space-y-1.5 overflow-hidden">
									<div className="flex w-full min-w-0 flex-wrap items-center gap-1.5 overflow-hidden">
										<p className="line-clamp-1 flex-1 font-medium text-sm">
											{download.title || download.url}
										</p>
										{download.type === "audio" && (
											<Badge
												className="shrink-0 px-1.5 py-0.5 text-[10px]"
												variant="secondary"
											>
												{t("download.audio")}
											</Badge>
										)}
									</div>
									<div className="flex w-full flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
										{statusIcon && (
											<Tooltip>
												<TooltipTrigger asChild>
													<div className="flex shrink-0 items-center">
														{statusIcon}
													</div>
												</TooltipTrigger>
												<TooltipContent>
													<p>{statusText}</p>
												</TooltipContent>
											</Tooltip>
										)}
										{isInProgressStatus && (
											<div className="flex min-w-0 items-center gap-2">
												<span className="shrink-0 font-medium">
													{(download.progress?.percent ?? 0).toFixed(1)}%
												</span>
												{download.progress?.downloaded &&
													download.progress?.total && (
														<span className="max-w-[120px] truncate">
															{download.progress.downloaded} /{" "}
															{download.progress.total}
														</span>
													)}
												{download.progress?.currentSpeed && (
													<span className="max-w-[80px] truncate">
														{download.progress.currentSpeed}
													</span>
												)}
												{download.progress?.eta && (
													<span className="max-w-[80px] truncate">
														ETA: {download.progress.eta}
													</span>
												)}
											</div>
										)}
										{timestamp && (
											<span className="shrink-0 truncate">
												{formatDateShort(timestamp)}
											</span>
										)}
										{qualityLabel && (
											<>
												<span className="shrink-0 text-muted-foreground/60">
													•
												</span>
												<span className="shrink-0">{qualityLabel}</span>
											</>
										)}
										{inlineFileSize && (
											<>
												<span className="shrink-0 text-muted-foreground/60">
													•
												</span>
												<span className="shrink-0">{inlineFileSize}</span>
											</>
										)}
									</div>
								</div>
								<div className="relative z-20 flex shrink-0 flex-wrap items-center justify-end gap-1 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
									{canRetry && (
										<Button
											className="h-8 w-8 shrink-0 rounded-full"
											onClick={(event) => {
												event.stopPropagation();
												handleRetryDownload();
											}}
											size="icon"
											variant="ghost"
										>
											<RotateCw className="h-4 w-4" />
										</Button>
									)}
									{showCopyAction && (
										<Button
											className="h-8 w-8 shrink-0 rounded-full"
											onClick={(event) => {
												event.stopPropagation();
												void handleCopyToClipboard();
											}}
											size="icon"
											variant="ghost"
										>
											<Copy className="h-4 w-4" />
										</Button>
									)}
									{showOpenFolderAction && (
										<Button
											className="h-8 w-8 shrink-0 rounded-full"
											onClick={(event) => {
												event.stopPropagation();
												void handleOpenFolder();
											}}
											size="icon"
											variant="ghost"
										>
											<FolderOpen className="h-4 w-4" />
										</Button>
									)}
									{isInProgressStatus && (
										<Button
											className="h-8 w-8 shrink-0 rounded-full"
											onClick={(event) => {
												event.stopPropagation();
												handleCancel();
											}}
											size="icon"
											variant="ghost"
										>
											<X className="h-4 w-4" />
										</Button>
									)}
								</div>
							</div>

							{download.progress &&
								!["completed", "error"].includes(download.status) && (
									<div className="w-full overflow-hidden bg-background/60">
										<Progress
											className="h-1 w-full"
											value={download.progress.percent}
										/>
									</div>
								)}

							{download.status === "error" && download.error && (
								<div className="flex flex-col gap-1.5">
									<p className="line-clamp-2 w-full overflow-hidden text-destructive text-xs">
										{download.error}
									</p>
									<div className="pointer-events-auto flex flex-wrap items-center gap-1.5 text-muted-foreground text-xs">
										<span className="shrink-0 font-medium text-muted-foreground text-xs">
											{t("download.feedback.title")}:
										</span>
										{canShowSheet && (
											<Button
												className="h-6 px-1.5 text-[10px]"
												onClick={(event) => {
													event.stopPropagation();
													openLogsSheet();
												}}
												size="sm"
												variant="outline"
											>
												{t("download.viewLogs")}
											</Button>
										)}
										<FeedbackLinkButtons
											buttonClassName="h-6 gap-1 px-1.5 text-[10px]"
											buttonSize="sm"
											buttonVariant="outline"
											error={download.error}
											iconClassName="h-3 w-3"
											issueTitle={DOWNLOAD_FEEDBACK_ISSUE_TITLE}
											onLinkClick={(event) => event.stopPropagation()}
											showGroupSeparator={canShowSheet}
											sourceUrl={download.url}
											wrapperClassName="flex flex-wrap items-center gap-1.5"
											ytDlpCommand={download.ytDlpCommand}
										/>
									</div>
								</div>
							)}
						</div>
					</div>

					{canShowSheet && (
						<Sheet onOpenChange={setSheetOpen} open={sheetOpen}>
							<SheetContent
								className="flex w-full flex-col p-0 sm:max-w-lg"
								side="right"
							>
								<div className="flex h-full flex-col overflow-hidden">
									<SheetHeader className="shrink-0 border-b px-6 pt-6 pb-4">
										<SheetTitle className="line-clamp-2">
											{download.title}
										</SheetTitle>
										<SheetDescription>
											{t("download.videoInfo")}
										</SheetDescription>
									</SheetHeader>
									<Tabs
										className="flex-1 overflow-hidden"
										onValueChange={(value) =>
											setActiveTab(value as "details" | "logs")
										}
										value={activeTab}
									>
										<div className="px-6 pt-4">
											<TabsList>
												<TabsTrigger
													disabled={!hasMetadataDetails}
													value="details"
												>
													{t("download.detailsTab")}
												</TabsTrigger>
												<TabsTrigger value="logs">
													{t("download.logsTab")}
												</TabsTrigger>
											</TabsList>
										</div>
										<TabsContent
											className="flex-1 overflow-y-auto px-6 py-4"
											value="details"
										>
											<div className="space-y-4">
												{metadataDetails.map((item, index) => (
													<div
														className="flex flex-col gap-1"
														key={`${item.label}-${index}`}
													>
														<span className="font-medium text-muted-foreground text-sm">
															{item.label}
														</span>
														<div className="break-words text-foreground text-sm">
															{item.value}
														</div>
													</div>
												))}
											</div>
										</TabsContent>
										<TabsContent
											className="flex flex-1 flex-col gap-3 overflow-hidden px-6 py-4"
											value="logs"
										>
											<div className="flex items-center justify-between text-muted-foreground text-xs">
												<span>
													{isInProgressStatus
														? t("download.logs.live")
														: t("download.logs.history")}
												</span>
												{logAutoScroll ? null : (
													<span className="text-muted-foreground/70">
														{t("download.logs.scrollPaused")}
													</span>
												)}
											</div>
											{hasYtDlpCommand && (
												<div className="rounded-md border border-border/60 bg-muted/20 p-2">
													<div className="font-medium text-[11px] text-muted-foreground">
														{t("download.logs.command")}
													</div>
													<div className="mt-1 whitespace-pre-wrap break-words font-mono text-xs">
														{ytDlpCommand}
													</div>
												</div>
											)}
											<div className="min-h-0 flex-1 rounded-md border border-border/60 bg-muted/30">
												<div
													className="h-full overflow-y-auto whitespace-pre-wrap break-words p-3 font-mono text-xs leading-relaxed"
													onScroll={handleLogScroll}
													ref={logContainerRef}
												>
													{hasLogContent
														? logContent
														: t("download.logs.empty")}
												</div>
											</div>
										</TabsContent>
									</Tabs>
								</div>
							</SheetContent>
						</Sheet>
					)}
				</div>
			</ContextMenuTrigger>

			<ContextMenuContent>
				{isInProgressStatus ? (
					<>
						{canRetry && (
							<ContextMenuItem onClick={handleRetryDownload}>
								<RotateCw className="h-4 w-4" />
								{t("download.retry")}
							</ContextMenuItem>
						)}
						<ContextMenuItem
							disabled={!showOpenFolderAction}
							onClick={() => {
								void handleOpenFolder();
							}}
						>
							<FolderOpen className="h-4 w-4" />
							{t("history.openFileLocation")}
						</ContextMenuItem>
						<ContextMenuItem
							disabled={!canCopyLink}
							onClick={() => void handleCopyLink()}
						>
							<span aria-hidden="true" className="h-4 w-4 shrink-0" />
							{t("history.copyUrl")}
						</ContextMenuItem>
						{canShowSheet && (
							<ContextMenuItem onClick={() => setSheetOpen(true)}>
								<span aria-hidden="true" className="h-4 w-4 shrink-0" />
								{t("download.showDetails")}
							</ContextMenuItem>
						)}
						<ContextMenuSeparator />
						<ContextMenuItem onClick={handleCancel}>
							<X className="h-4 w-4" />
							{t("download.cancel")}
						</ContextMenuItem>
					</>
				) : (
					<>
						{isCompletedStatus && (
							<ContextMenuItem
								disabled={!showCopyAction}
								onClick={() => {
									void handleCopyToClipboard();
								}}
							>
								<Copy className="h-4 w-4" />
								{t("history.copyToClipboard")}
							</ContextMenuItem>
						)}
						{canRetry && (
							<ContextMenuItem onClick={handleRetryDownload}>
								<RotateCw className="h-4 w-4" />
								{t("download.retry")}
							</ContextMenuItem>
						)}
						<ContextMenuItem
							disabled={!canOpenFile}
							onClick={() => {
								void handleOpenFile();
							}}
						>
							<File className="h-4 w-4" />
							{t("history.openFile")}
						</ContextMenuItem>
						<ContextMenuSeparator />
						<ContextMenuItem
							disabled={!showOpenFolderAction}
							onClick={() => {
								void handleOpenFolder();
							}}
						>
							<FolderOpen className="h-4 w-4" />
							{t("history.openFileLocation")}
						</ContextMenuItem>
						<ContextMenuItem
							disabled={!canCopyLink}
							onClick={() => void handleCopyLink()}
						>
							<span aria-hidden="true" className="h-4 w-4 shrink-0" />
							{t("history.copyUrl")}
						</ContextMenuItem>
						{canShowSheet && (
							<ContextMenuItem onClick={() => setSheetOpen(true)}>
								<span aria-hidden="true" className="h-4 w-4 shrink-0" />
								{t("download.showDetails")}
							</ContextMenuItem>
						)}
						<ContextMenuSeparator />
						<ContextMenuItem
							disabled={!canDeleteFile}
							onClick={() => {
								void handleDeleteFile();
							}}
						>
							<Trash2 className="h-4 w-4" />
							{t("history.deleteFile")}
						</ContextMenuItem>
						<ContextMenuItem
							disabled={!canDeleteRecord}
							onClick={handleDeleteRecord}
						>
							<span aria-hidden="true" className="h-4 w-4 shrink-0" />
							{t("history.deleteRecord")}
						</ContextMenuItem>
					</>
				)}
			</ContextMenuContent>
		</ContextMenu>
	);
}
