import { useNavigate } from "@tanstack/react-router";
import {
	buildFilePathCandidates,
	normalizeSavedFileName,
} from "@vidbee/downloader-core/download-file";
import { Button } from "@vidbee/ui/components/ui/button";
import { CardContent, CardHeader } from "@vidbee/ui/components/ui/card";
import { Checkbox } from "@vidbee/ui/components/ui/checkbox";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@vidbee/ui/components/ui/dialog";
import { DownloadEmptyState } from "@vidbee/ui/components/ui/download-empty-state";
import {
	DownloadFilterBar,
	type DownloadFilterItem,
} from "@vidbee/ui/components/ui/download-filter-bar";
import { DownloadSelectionToolbar } from "@vidbee/ui/components/ui/download-selection-toolbar";
import { ListMarqueeBox } from "@vidbee/ui/components/ui/list-marquee-box";
import { ScrollArea } from "@vidbee/ui/components/ui/scroll-area";
import { cn } from "@vidbee/ui/lib/cn";
import {
	ALL_DOWNLOAD_PLATFORM_FILTER,
	downloadPlatformDisplayLabel,
	listDownloadPlatformCounts,
	matchesDownloadPlatformFilter,
} from "@vidbee/ui/lib/download-platform";
import { useListMarqueeSelection } from "@vidbee/ui/lib/use-list-marquee";
import { Layers } from "lucide-react";
import {
	useCallback,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
} from "react";
import { Trans, useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useWebSettings } from "../../hooks/use-web-settings";
import { notifyDownloadCompleted } from "../../lib/download-notifications";
import { logger } from "../../lib/logger";
import { eventsUrl, orpcClient } from "../../lib/orpc-client";
import { readWebSettings } from "../../lib/web-settings";
import { DownloadDialog } from "../download/download-dialog";
import { DownloadItem } from "../download/download-item";
import { PlaylistDownloadGroup } from "../download/playlist-download-group";
import type { DownloadRecord } from "../download/types";
import { AppShell } from "../layout/app-shell";

type ConfirmAction =
	| { type: "delete-selected"; ids: string[] }
	| {
			type: "delete-playlist";
			playlistId: string;
			title: string;
			ids: string[];
	  };

const POLL_INTERVAL_MS = 2000;

const isEditableTarget = (target: EventTarget | null): boolean => {
	if (!(target && target instanceof HTMLElement)) {
		return false;
	}
	if (target.isContentEditable) {
		return true;
	}
	const tagName = target.tagName;
	return tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT";
};

const resolveDownloadExtension = (record: DownloadRecord): string => {
	const savedExt = normalizeSavedFileName(record.savedFileName)
		? record.savedFileName?.split(".").at(-1)?.toLowerCase()
		: undefined;
	if (savedExt) {
		return savedExt;
	}
	return record.type === "audio" ? "mp3" : "mp4";
};

export const DownloadPage = () => {
	const { t } = useTranslation();
	const navigate = useNavigate();
	const { settings } = useWebSettings();
	const [allRecords, setAllRecords] = useState<DownloadRecord[]>([]);
	const [platformFilter, setPlatformFilter] = useState(
		ALL_DOWNLOAD_PLATFORM_FILTER,
	);
	const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
	const listRef = useRef<HTMLDivElement>(null);
	const { finishPointer, marquee, onPointerDown, onPointerMove } =
		useListMarqueeSelection({
			containerRef: listRef,
			onSelectIds: (ids) => {
				setSelectedIds(new Set(ids));
			},
			selectedIds,
		});
	const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(
		null,
	);
	const [confirmBusy, setConfirmBusy] = useState(false);
	const [alsoDeleteFiles, setAlsoDeleteFiles] = useState(false);
	const alsoDeleteFilesId = useId();
	const [isApiReachable, setIsApiReachable] = useState(false);
	const [apiConnectionMessage, setApiConnectionMessage] = useState("");

	const refreshData = useCallback(async () => {
		try {
			const [downloadsResult, historyResult] = await Promise.all([
				orpcClient.downloads.list(),
				orpcClient.history.list(),
			]);

			const activeEntries: DownloadRecord[] = downloadsResult.downloads.map(
				(record) => ({
					...record,
					entryType: "active",
				}),
			);
			const historyEntries: DownloadRecord[] = historyResult.history.map(
				(record) => ({
					...record,
					entryType: "history",
				}),
			);

			const merged = [...activeEntries, ...historyEntries].sort(
				(left, right) => {
					const leftTime = left.completedAt ?? left.createdAt;
					const rightTime = right.completedAt ?? right.createdAt;
					return rightTime - leftTime;
				},
			);

			setAllRecords((previous) => {
				if (settings.enableDownloadNotifications && previous.length > 0) {
					const previousStatus = new Map(
						previous.map((record) => [record.id, record.status]),
					);
					for (const record of merged) {
						if (
							record.status === "completed" &&
							previousStatus.get(record.id) !== "completed"
						) {
							notifyDownloadCompleted(
								record.id,
								record.title || record.url,
								true,
							);
						}
					}
				}
				return merged;
			});
			setIsApiReachable(true);
			setApiConnectionMessage("");
		} catch (error) {
			setIsApiReachable(false);
			const message =
				error instanceof Error ? error.message : t("errors.networkError");
			setApiConnectionMessage(message);
		}
	}, [settings.enableDownloadNotifications, t]);

	useEffect(() => {
		void refreshData();
		const timer = window.setInterval(() => {
			void refreshData();
		}, POLL_INTERVAL_MS);

		return () => {
			window.clearInterval(timer);
		};
	}, [refreshData]);

	useEffect(() => {
		if (!isApiReachable) {
			return;
		}

		const source = new EventSource(eventsUrl);
		const onChanged = () => {
			void refreshData();
		};
		const onError = () => {
			setIsApiReachable(false);
			source.close();
		};

		source.addEventListener("task-updated", onChanged);
		source.addEventListener("queue-updated", onChanged);
		source.addEventListener("error", onError);

		return () => {
			source.removeEventListener("task-updated", onChanged);
			source.removeEventListener("queue-updated", onChanged);
			source.removeEventListener("error", onError);
			source.close();
		};
	}, [isApiReachable, refreshData]);

	const hasCookieConfig = useMemo(() => {
		const cookiesPath = settings.cookiesPath?.trim();
		if (cookiesPath) {
			return true;
		}
		const browserSetting = settings.browserForCookies?.trim();
		return Boolean(browserSetting && browserSetting !== "none");
	}, [settings.browserForCookies, settings.cookiesPath]);

	const historyRecords = useMemo(
		() => allRecords.filter((record) => record.entryType === "history"),
		[allRecords],
	);

	const platformCounts = useMemo(
		() => listDownloadPlatformCounts(allRecords.map((record) => record.url)),
		[allRecords],
	);

	const filteredRecords = useMemo(() => {
		return allRecords.filter((record) =>
			matchesDownloadPlatformFilter(record.url, platformFilter),
		);
	}, [allRecords, platformFilter]);

	const visibleHistoryIds = useMemo(
		() =>
			filteredRecords
				.filter((record) => record.entryType === "history")
				.map((record) => record.id),
		[filteredRecords],
	);

	const filters = useMemo((): Array<DownloadFilterItem<string>> => {
		const items: Array<DownloadFilterItem<string>> = [
			{
				key: ALL_DOWNLOAD_PLATFORM_FILTER,
				label: t("download.all"),
				count: allRecords.length,
				icon: <Layers className="size-3.5" />,
			},
		];
		for (const platform of platformCounts) {
			items.push({
				key: platform.key,
				label: downloadPlatformDisplayLabel(platform, {
					local: t("download.localSource"),
					other: t("download.otherSource"),
				}),
				count: platform.count,
				domain: platform.domain,
			});
		}
		return items;
	}, [allRecords.length, platformCounts, t]);

	useEffect(() => {
		if (platformFilter === ALL_DOWNLOAD_PLATFORM_FILTER) {
			return;
		}
		if (platformCounts.some((platform) => platform.key === platformFilter)) {
			return;
		}
		setPlatformFilter(ALL_DOWNLOAD_PLATFORM_FILTER);
	}, [platformCounts, platformFilter]);

	const selectableIds = useMemo(() => {
		if (visibleHistoryIds.length === 0) {
			return [];
		}
		const ids = new Set(visibleHistoryIds);
		const playlistIds = new Set(
			filteredRecords
				.filter((record) => record.entryType === "history" && record.playlistId)
				.map((record) => record.playlistId as string),
		);
		if (playlistIds.size === 0) {
			return Array.from(ids);
		}
		for (const record of historyRecords) {
			if (record.playlistId && playlistIds.has(record.playlistId)) {
				ids.add(record.id);
			}
		}
		return Array.from(ids);
	}, [filteredRecords, historyRecords, visibleHistoryIds]);

	const selectedCount = selectedIds.size;
	const allSelected =
		selectableIds.length > 0 &&
		selectableIds.every((id) => selectedIds.has(id));
	const selectionSummary = t("history.selectedCount", { count: selectedCount });

	useEffect(() => {
		if (selectedIds.size === 0) {
			return;
		}
		const historyIdSet = new Set(historyRecords.map((record) => record.id));
		setSelectedIds((prev) => {
			let changed = false;
			const next = new Set<string>();
			for (const id of prev) {
				if (historyIdSet.has(id)) {
					next.add(id);
				} else {
					changed = true;
				}
			}
			return changed ? next : prev;
		});
	}, [historyRecords, selectedIds.size]);

	const handleToggleSelect = (id: string) => {
		setSelectedIds((prev) => {
			const next = new Set(prev);
			if (next.has(id)) {
				next.delete(id);
			} else {
				next.add(id);
			}
			return next;
		});
	};

	/**
	 * Select every selectable row, or clear the selection when already complete.
	 */
	const handleToggleSelectAll = () => {
		if (allSelected) {
			setSelectedIds(new Set());
			return;
		}
		if (selectableIds.length === 0) {
			return;
		}
		setSelectedIds(new Set(selectableIds));
	};

	const handleRequestDeleteSelected = () => {
		if (selectedIds.size === 0) {
			return;
		}
		setConfirmAction({ type: "delete-selected", ids: Array.from(selectedIds) });
	};

	const handleRequestDeletePlaylist = (
		playlistId: string,
		title: string,
		ids: string[],
	) => {
		if (ids.length === 0) {
			return;
		}
		setConfirmAction({ type: "delete-playlist", playlistId, title, ids });
	};

	const pruneSelectedIds = (ids: string[]) => {
		if (ids.length === 0) {
			return;
		}
		setSelectedIds((prev) => {
			const next = new Set(prev);
			let changed = false;
			ids.forEach((id) => {
				if (next.delete(id)) {
					changed = true;
				}
			});
			return changed ? next : prev;
		});
	};

	const confirmContent = useMemo(() => {
		if (!confirmAction) {
			return null;
		}
		switch (confirmAction.type) {
			case "delete-selected": {
				return {
					title: t("history.confirmDeleteSelectedTitle"),
					description: t("history.confirmDeleteSelectedDescription", {
						count: confirmAction.ids.length,
					}),
					actionLabel: t("history.removeAction"),
				};
			}
			case "delete-playlist": {
				return {
					title: t("history.confirmDeletePlaylistTitle"),
					description: t("history.confirmDeletePlaylistDescription", {
						count: confirmAction.ids.length,
						title: confirmAction.title,
					}),
					actionLabel: t("history.removeAction"),
				};
			}
			default:
				return null;
		}
	}, [confirmAction, t]);

	const handleConfirmAction = async () => {
		if (!confirmAction) {
			return;
		}
		setConfirmBusy(true);
		try {
			if (confirmAction.type === "delete-selected") {
				const selectedHistoryRecords = allRecords.filter(
					(record) =>
						confirmAction.ids.includes(record.id) &&
						record.entryType === "history",
				);

				if (alsoDeleteFiles) {
					const fallbackPath = readWebSettings().downloadPath.trim();
					const candidatePaths = new Set<string>();

					for (const record of selectedHistoryRecords) {
						const downloadPath = record.downloadPath?.trim() || fallbackPath;
						if (!(downloadPath && record.title)) {
							continue;
						}
						const extension = resolveDownloadExtension(record);
						const candidates = buildFilePathCandidates(
							downloadPath,
							record.title,
							extension,
							record.savedFileName,
						);
						for (const candidate of candidates) {
							candidatePaths.add(candidate);
						}
					}

					await Promise.allSettled(
						Array.from(candidatePaths).map(async (candidate) => {
							await orpcClient.files.deleteFile({ path: candidate });
						}),
					);
				}

				const result = await orpcClient.history.removeItems({
					ids: confirmAction.ids,
				});
				pruneSelectedIds(confirmAction.ids);
				await refreshData();
				toast.success(
					t("notifications.itemsRemoved", { count: result.removed }),
				);
			}
			if (confirmAction.type === "delete-playlist") {
				const result = await orpcClient.history.removeByPlaylist({
					playlistId: confirmAction.playlistId,
				});
				pruneSelectedIds(confirmAction.ids);
				await refreshData();
				toast.success(
					t("notifications.playlistHistoryRemoved", { count: result.removed }),
				);
			}
			setConfirmAction(null);
			setAlsoDeleteFiles(false);
		} catch (error) {
			if (confirmAction.type === "delete-selected") {
				logger.error("Failed to remove selected history items:", error);
				toast.error(t("notifications.itemsRemoveFailed"));
			}
			if (confirmAction.type === "delete-playlist") {
				logger.error("Failed to remove playlist history:", error);
				toast.error(t("notifications.playlistHistoryRemoveFailed"));
			}
		} finally {
			setConfirmBusy(false);
		}
	};

	const groupedView = useMemo(() => {
		const groups = new Map<
			string,
			{
				id: string;
				title: string;
				totalCount: number;
				records: DownloadRecord[];
			}
		>();
		const order: Array<
			{ type: "group"; id: string } | { type: "single"; record: DownloadRecord }
		> = [];

		for (const record of filteredRecords) {
			if (record.playlistId) {
				let group = groups.get(record.playlistId);
				if (!group) {
					group = {
						id: record.playlistId,
						title:
							record.playlistTitle || record.title || t("playlist.untitled"),
						totalCount: record.playlistSize || 0,
						records: [],
					};
					groups.set(record.playlistId, group);
					order.push({ type: "group", id: record.playlistId });
				}
				group.records.push(record);
				if (!group.title && record.playlistTitle) {
					group.title = record.playlistTitle;
				}
				if (!group.totalCount && record.playlistSize) {
					group.totalCount = record.playlistSize;
				}
			} else {
				order.push({ type: "single", record });
			}
		}

		for (const group of groups.values()) {
			group.records.sort((a, b) => {
				const aIndex = a.playlistIndex ?? Number.MAX_SAFE_INTEGER;
				const bIndex = b.playlistIndex ?? Number.MAX_SAFE_INTEGER;
				if (aIndex !== bIndex) {
					return aIndex - bIndex;
				}
				return b.createdAt - a.createdAt;
			});
			if (!group.totalCount) {
				group.totalCount = group.records.length;
			}
		}

		return { order, groups };
	}, [filteredRecords, t]);

	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.defaultPrevented) {
				return;
			}
			if (isEditableTarget(event.target)) {
				return;
			}
			if (event.key === "Escape") {
				if (confirmAction) {
					return;
				}
				if (selectedIds.size === 0) {
					return;
				}
				setSelectedIds(new Set());
				return;
			}
			if (!(event.metaKey || event.ctrlKey)) {
				return;
			}
			if (event.key.toLowerCase() !== "a") {
				return;
			}
			if (selectableIds.length === 0) {
				return;
			}
			event.preventDefault();
			setSelectedIds(new Set(selectableIds));
		};

		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [confirmAction, selectableIds, selectedIds]);

	const handleCancelDownload = async (id: string) => {
		try {
			await orpcClient.downloads.cancel({ id });
			await refreshData();
		} catch (error) {
			logger.error("Failed to cancel download:", error);
			toast.error(t("notifications.downloadFailed"));
		}
	};

	/**
	 * Pause an in-flight download and refresh the queue snapshot.
	 *
	 * @param id Download id.
	 */
	const handlePauseDownload = async (id: string) => {
		try {
			await orpcClient.downloads.pause({ id });
			await refreshData();
		} catch (error) {
			logger.error("Failed to pause download:", error);
			toast.error(t("notifications.downloadFailed"));
		}
	};

	/**
	 * Resume a paused download and refresh the queue snapshot.
	 *
	 * @param id Download id.
	 */
	const handleResumeDownload = async (id: string) => {
		try {
			await orpcClient.downloads.resume({ id });
			await refreshData();
		} catch (error) {
			logger.error("Failed to resume download:", error);
			toast.error(t("notifications.downloadFailed"));
		}
	};

	const handleRetryDownload = async (download: DownloadRecord) => {
		if (!download.url) {
			toast.error(t("errors.emptyUrl"));
			return;
		}

		try {
			const result = await orpcClient.downloads.retry({ id: download.id });
			if (!result.retried) {
				toast.info(t("notifications.downloadAlreadyQueued"));
				return;
			}
			await refreshData();
		} catch (error) {
			logger.error("Failed to retry download:", error);
			toast.error(t("notifications.downloadFailed"));
		}
	};

	const handleRemoveHistoryRecord = async (id: string) => {
		try {
			await orpcClient.history.removeItems({ ids: [id] });
			pruneSelectedIds([id]);
			await refreshData();
		} catch (error) {
			logger.error("Failed to remove history record:", error);
			toast.error(t("notifications.removeFailed"));
		}
	};

	const handleCopyUrl = async (url: string) => {
		if (!navigator.clipboard?.writeText) {
			toast.error(t("notifications.copyFailed"));
			return;
		}

		try {
			await navigator.clipboard.writeText(url);
			toast.success(t("notifications.urlCopied"));
		} catch (error) {
			logger.error("Failed to copy url:", error);
			toast.error(t("notifications.copyFailed"));
		}
	};

	return (
		<AppShell page="download">
			<div className={cn("flex h-full flex-col")}>
				<CardHeader className="z-50 gap-4 bg-background p-0 px-6 py-4 backdrop-blur">
					<DownloadFilterBar
						actions={<DownloadDialog onDownloadsChanged={refreshData} />}
						activeFilter={platformFilter}
						filters={filters}
						onFilterChange={setPlatformFilter}
						overflowLabel={t("download.morePlatforms")}
					/>
					{!isApiReachable && apiConnectionMessage ? (
						<p className="font-medium text-destructive text-sm">
							{apiConnectionMessage}
						</p>
					) : null}
				</CardHeader>

				<ScrollArea className="flex-1 overflow-y-auto">
					<CardContent className="w-full space-y-3 overflow-x-hidden p-0">
						{!hasCookieConfig ? (
							<div className="mx-6 mt-4 rounded-xl bg-muted/40 px-6 py-5">
								<div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
									<div className="space-y-1">
										<p className="font-bold text-[10px] text-muted-foreground/70 uppercase tracking-wider">
											{t("history.cookiesTipTitle")}
										</p>
										<p className="max-w-[540px] text-foreground/85 text-sm leading-relaxed">
											<Trans
												components={{
													strong: (
														<strong className="font-semibold text-foreground" />
													),
												}}
												i18nKey="history.cookiesTipDescription"
											/>
										</p>
									</div>
									<Button
										className="h-8 rounded-lg px-4 font-medium text-xs"
										onClick={() => {
											void navigate({
												to: "/settings",
												search: { tab: "cookies" },
											});
										}}
									>
										{t("history.cookiesTipAction")}
									</Button>
								</div>
							</div>
						) : null}
						{filteredRecords.length === 0 ? (
							<DownloadEmptyState
								className="mx-6 mb-4"
								hint={t("download.ingestEmptyHint")}
								message={t("download.noItems")}
							/>
						) : (
							<div
								className={cn("relative w-full pb-4", marquee && "select-none")}
								onPointerCancel={finishPointer}
								onPointerDown={onPointerDown}
								onPointerMove={onPointerMove}
								onPointerUp={finishPointer}
								ref={listRef}
							>
								{marquee ? <ListMarqueeBox marquee={marquee} /> : null}
								{groupedView.order.map((item) => {
									if (item.type === "single") {
										return (
											<DownloadItem
												download={item.record}
												isSelected={selectedIds.has(item.record.id)}
												key={`${item.record.entryType}:${item.record.id}`}
												onCancel={handleCancelDownload}
												onCopyUrl={handleCopyUrl}
												onPause={handlePauseDownload}
												onRemove={handleRemoveHistoryRecord}
												onResume={handleResumeDownload}
												onRetry={handleRetryDownload}
												onToggleSelect={handleToggleSelect}
												selectionActive={selectedCount > 0}
											/>
										);
									}

									const group = groupedView.groups.get(item.id);
									if (!group) {
										return null;
									}

									return (
										<PlaylistDownloadGroup
											groupId={group.id}
											key={`group:${group.id}`}
											onCancel={handleCancelDownload}
											onCopyUrl={handleCopyUrl}
											onDeletePlaylist={handleRequestDeletePlaylist}
											onPause={handlePauseDownload}
											onRemove={handleRemoveHistoryRecord}
											onResume={handleResumeDownload}
											onRetry={handleRetryDownload}
											onToggleSelect={handleToggleSelect}
											records={group.records}
											selectedIds={selectedIds}
											selectionActive={selectedCount > 0}
											title={group.title}
											totalCount={group.totalCount}
										/>
									);
								})}
							</div>
						)}
					</CardContent>
				</ScrollArea>

				{selectedCount > 0 && (
					<div className="fixed bottom-4 left-1/2 z-40 -translate-x-1/2 sm:right-6 sm:left-auto sm:translate-x-0">
						<DownloadSelectionToolbar
							allSelected={allSelected}
							clearLabel={t("history.clearSelection")}
							countLabel={selectionSummary}
							deleteLabel={t("history.deleteSelected")}
							onDelete={handleRequestDeleteSelected}
							onToggleSelectAll={handleToggleSelectAll}
							selectAllLabel={t("history.selectAll")}
						/>
					</div>
				)}

				<Dialog
					onOpenChange={(open) => {
						if (!(open || confirmBusy)) {
							setConfirmAction(null);
							setAlsoDeleteFiles(false);
						}
					}}
					open={Boolean(confirmAction)}
				>
					{confirmContent && (
						<DialogContent>
							<DialogHeader>
								<DialogTitle>{confirmContent.title}</DialogTitle>
								<DialogDescription>
									{confirmContent.description}
								</DialogDescription>
							</DialogHeader>
							{confirmAction?.type === "delete-selected" && (
								<div className="flex items-center space-x-2">
									<Checkbox
										checked={alsoDeleteFiles}
										id={alsoDeleteFilesId}
										onCheckedChange={(checked) =>
											setAlsoDeleteFiles(checked === true)
										}
									/>
									<label
										className="cursor-pointer font-medium text-sm leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
										htmlFor={alsoDeleteFilesId}
									>
										<Trans i18nKey="history.alsoDeleteFiles" />
									</label>
								</div>
							)}
							<DialogFooter>
								<Button
									disabled={confirmBusy}
									onClick={() => {
										setConfirmAction(null);
										setAlsoDeleteFiles(false);
									}}
									variant="outline"
								>
									{t("download.cancel")}
								</Button>
								<Button
									disabled={confirmBusy}
									onClick={handleConfirmAction}
									variant="destructive"
								>
									{confirmContent.actionLabel}
								</Button>
							</DialogFooter>
						</DialogContent>
					)}
				</Dialog>
			</div>
		</AppShell>
	);
};
