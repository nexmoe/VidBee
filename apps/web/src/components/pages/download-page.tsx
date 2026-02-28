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
import { ScrollArea } from "@vidbee/ui/components/ui/scroll-area";
import { cn } from "@vidbee/ui/lib/cn";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { toast } from "sonner";
import { eventsUrl, orpcClient } from "../../lib/orpc-client";
import { readOrpcDownloadSettings } from "../../lib/orpc-download-settings";
import { DownloadDialog } from "../download/download-dialog";
import { DownloadItem } from "../download/download-item";
import { PlaylistDownloadGroup } from "../download/playlist-download-group";
import type { DownloadRecord, StatusFilter } from "../download/types";
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

export const DownloadPage = () => {
	const { t } = useTranslation();
	const [allRecords, setAllRecords] = useState<DownloadRecord[]>([]);
	const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
	const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
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

			setAllRecords(merged);
			setIsApiReachable(true);
			setApiConnectionMessage("");
		} catch (error) {
			setIsApiReachable(false);
			const message =
				error instanceof Error ? error.message : t("errors.networkError");
			setApiConnectionMessage(message);
		}
	}, [t]);

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

	const historyRecords = useMemo(
		() => allRecords.filter((record) => record.entryType === "history"),
		[allRecords],
	);

	const downloadStats = useMemo(() => {
		return allRecords.reduce(
			(acc, item) => {
				acc.total += 1;
				if (
					(item.entryType === "active" && item.status === "downloading") ||
					item.status === "processing" ||
					item.status === "pending"
				) {
					acc.active += 1;
				}
				if (item.status === "completed") {
					acc.completed += 1;
				}
				if (item.status === "error") {
					acc.error += 1;
				}
				return acc;
			},
			{ total: 0, active: 0, completed: 0, error: 0 },
		);
	}, [allRecords]);

	const filteredRecords = useMemo(() => {
		return allRecords.filter((record) => {
			switch (statusFilter) {
				case "all":
					return true;
				case "active":
					return (
						record.status === "downloading" ||
						record.status === "processing" ||
						record.status === "pending"
					);
				case "completed":
				case "error":
					return record.status === statusFilter;
				default:
					return true;
			}
		});
	}, [allRecords, statusFilter]);

	const visibleHistoryIds = useMemo(
		() =>
			filteredRecords
				.filter((record) => record.entryType === "history")
				.map((record) => record.id),
		[filteredRecords],
	);

	const filters: Array<DownloadFilterItem<StatusFilter>> = [
		{ key: "all", label: t("download.all"), count: downloadStats.total },
		{ key: "active", label: t("download.active"), count: downloadStats.active },
		{
			key: "completed",
			label: t("download.completed"),
			count: downloadStats.completed,
		},
		{ key: "error", label: t("download.error"), count: downloadStats.error },
	];

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

	const selectableCount = selectableIds.length;
	const selectedCount = selectedIds.size;
	const visibleSelectableCount = visibleHistoryIds.length;
	const selectionSummary =
		selectableCount === 0
			? t("history.selectedCount", { count: selectedCount })
			: selectableCount > visibleSelectableCount
				? t("history.selectedCount", { count: selectedCount })
				: t("history.selectionSummary", {
						selected: selectedCount,
						total: selectableCount,
					});

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

	const handleClearSelection = () => {
		setSelectedIds(new Set());
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
				console.error("Failed to remove selected history items:", error);
				toast.error(t("notifications.itemsRemoveFailed"));
			}
			if (confirmAction.type === "delete-playlist") {
				console.error("Failed to remove playlist history:", error);
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
			console.error("Failed to cancel download:", error);
			toast.error(t("notifications.downloadFailed"));
		}
	};

	const handleRetryDownload = async (download: DownloadRecord) => {
		if (!download.url) {
			toast.error(t("errors.emptyUrl"));
			return;
		}

		try {
			await orpcClient.downloads.create({
				url: download.url,
				type: download.type,
				title: download.title,
				thumbnail: download.thumbnail,
				duration: download.duration,
				description: download.description,
				channel: download.channel,
				uploader: download.uploader,
				viewCount: download.viewCount,
				tags: download.tags,
				selectedFormat: download.selectedFormat,
				playlistId: download.playlistId,
				playlistTitle: download.playlistTitle,
				playlistIndex: download.playlistIndex,
				playlistSize: download.playlistSize,
				format: download.selectedFormat?.formatId,
				audioFormat: download.type === "audio" ? "mp3" : undefined,
				settings: readOrpcDownloadSettings(),
			});
			await refreshData();
		} catch (error) {
			console.error("Failed to retry download:", error);
			toast.error(t("notifications.downloadFailed"));
		}
	};

	const handleRemoveHistoryRecord = async (id: string) => {
		try {
			await orpcClient.history.removeItems({ ids: [id] });
			pruneSelectedIds([id]);
			await refreshData();
		} catch (error) {
			console.error("Failed to remove history record:", error);
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
			console.error("Failed to copy url:", error);
			toast.error(t("notifications.copyFailed"));
		}
	};

	return (
		<AppShell page="download">
			<div className={cn("flex h-full flex-col")}>
				<CardHeader className="z-50 gap-4 bg-background p-0 px-6 py-4 backdrop-blur">
					<DownloadFilterBar
						actions={<DownloadDialog onDownloadsChanged={refreshData} />}
						activeFilter={statusFilter}
						filters={filters}
						onFilterChange={setStatusFilter}
					/>
					{!isApiReachable && apiConnectionMessage ? (
						<p className="font-medium text-destructive text-sm">
							{apiConnectionMessage}
						</p>
					) : null}
				</CardHeader>

				<ScrollArea className="flex-1 overflow-y-auto">
					<CardContent className="w-full space-y-3 overflow-x-hidden p-0">
						{filteredRecords.length === 0 ? (
							<DownloadEmptyState
								className="mx-6 mb-4"
								message={t("download.noItems")}
							/>
						) : (
							<div className="w-full pb-4">
								{groupedView.order.map((item) => {
									if (item.type === "single") {
										return (
											<DownloadItem
												download={item.record}
												isSelected={selectedIds.has(item.record.id)}
												key={`${item.record.entryType}:${item.record.id}`}
												onCancel={handleCancelDownload}
												onCopyUrl={handleCopyUrl}
												onRemove={handleRemoveHistoryRecord}
												onRetry={handleRetryDownload}
												onToggleSelect={handleToggleSelect}
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
											onRemove={handleRemoveHistoryRecord}
											onRetry={handleRetryDownload}
											onToggleSelect={handleToggleSelect}
											records={group.records}
											selectedIds={selectedIds}
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
					<div className="fixed bottom-4 left-1/2 z-40 w-[calc(100%-2rem)] -translate-x-1/2 sm:right-6 sm:left-auto sm:w-auto sm:translate-x-0">
						<div className="flex flex-wrap items-center justify-between gap-3 rounded-full border border-border/50 bg-background/80 py-2 pr-2 pl-5 shadow-lg backdrop-blur">
							<div className="flex flex-wrap items-center gap-2">
								<span className="text-muted-foreground text-xs">
									{selectionSummary}
								</span>
							</div>
							<div className="flex flex-wrap items-center gap-2">
								<Button
									className="h-8 rounded-full px-3"
									onClick={handleClearSelection}
									size="sm"
									variant="ghost"
								>
									{t("history.clearSelection")}
								</Button>
								<Button
									className="h-8 rounded-full px-3"
									onClick={handleRequestDeleteSelected}
									size="sm"
									variant="destructive"
								>
									{t("history.deleteSelected")}
								</Button>
							</div>
						</div>
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
