import { Button } from "@vidbee/ui/components/ui/button";
import { Progress } from "@vidbee/ui/components/ui/progress";
import { ChevronDown, ChevronRight, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { DownloadItem } from "./download-item";
import type { DownloadRecord } from "./types";

interface PlaylistDownloadGroupProps {
	groupId: string;
	title: string;
	records: DownloadRecord[];
	totalCount: number;
	selectedIds?: Set<string>;
	onToggleSelect?: (id: string) => void;
	onDeletePlaylist?: (playlistId: string, title: string, ids: string[]) => void;
	onCancel?: (id: string) => void;
	onRetry?: (download: DownloadRecord) => void;
	onRemove?: (id: string) => void;
	onCopyUrl?: (url: string) => void;
}

const STORAGE_KEY_PREFIX = "playlist_expanded_";

const getStorageKey = (groupId: string): string => {
	return `${STORAGE_KEY_PREFIX}${groupId}`;
};

const loadExpandedState = (groupId: string): boolean => {
	try {
		const stored = localStorage.getItem(getStorageKey(groupId));
		return stored === "true";
	} catch (error) {
		console.error("Failed to load playlist expanded state:", error);
		return false;
	}
};

const saveExpandedState = (groupId: string, isExpanded: boolean): void => {
	try {
		localStorage.setItem(getStorageKey(groupId), String(isExpanded));
	} catch (error) {
		console.error("Failed to save playlist expanded state:", error);
	}
};

export function PlaylistDownloadGroup({
	groupId,
	title,
	records,
	totalCount,
	selectedIds,
	onToggleSelect,
	onDeletePlaylist,
	onCancel,
	onRetry,
	onRemove,
	onCopyUrl,
}: PlaylistDownloadGroupProps) {
	const { t } = useTranslation();
	const [isExpanded, setIsExpanded] = useState(() =>
		loadExpandedState(groupId),
	);

	useEffect(() => {
		saveExpandedState(groupId, isExpanded);
	}, [groupId, isExpanded]);

	const completedCount = records.filter(
		(record) => record.status === "completed",
	).length;
	const errorCount = records.filter(
		(record) => record.status === "error",
	).length;
	const activeCount = records.filter((record) =>
		["downloading", "processing", "pending"].includes(record.status),
	).length;

	const displayTitle = title || t("playlist.untitled");
	const historyRecords = records.filter(
		(record) => record.entryType === "history",
	);
	const canDeletePlaylist =
		historyRecords.length > 0 && Boolean(onDeletePlaylist);
	const toggleLabel = isExpanded
		? t("playlist.groupCollapse")
		: t("playlist.groupExpand");
	const totalProgress = records.reduce((acc, record) => {
		if (record.status === "completed") {
			return acc + 1;
		}
		if (record.progress?.percent && record.progress.percent > 0) {
			return acc + Math.min(record.progress.percent, 100) / 100;
		}
		return acc;
	}, 0);
	const aggregatePercent =
		totalCount > 0 ? Math.min((totalProgress / totalCount) * 100, 100) : 0;

	return (
		<div className="mx-6 rounded-md bg-muted/30">
			<div className="flex items-center justify-between gap-2">
				<button
					aria-expanded={isExpanded}
					aria-label={toggleLabel}
					className="flex min-w-0 flex-1 items-center gap-2 rounded-md p-1.5 px-3 transition-colors hover:bg-muted/40 active:bg-muted/60"
					onClick={() => setIsExpanded((prev) => !prev)}
					title={toggleLabel}
					type="button"
				>
					<div className="flex shrink-0 items-center justify-center text-muted-foreground">
						{isExpanded ? (
							<ChevronDown className="h-5 w-5" />
						) : (
							<ChevronRight className="h-5 w-5" />
						)}
					</div>
					<div className="min-w-0 flex-1 text-left">
						<p className="truncate font-medium text-foreground text-sm">
							{displayTitle}
						</p>
						<div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
							<span>
								{t("playlist.collapsedProgress", {
									completed: completedCount,
									total: totalCount,
								})}
							</span>
							{activeCount > 0 && (
								<>
									<span className="text-muted-foreground/50">•</span>
									<span>
										{t("playlist.groupActive", { count: activeCount })}
									</span>
								</>
							)}
							{errorCount > 0 && (
								<>
									<span className="text-muted-foreground/50">•</span>
									<span className="text-destructive">
										{t("playlist.groupErrors", { count: errorCount })}
									</span>
								</>
							)}
						</div>
					</div>
				</button>
				<div className="flex shrink-0 items-center gap-1 pr-3">
					{canDeletePlaylist && (
						<Button
							aria-label={t("history.deletePlaylist")}
							className="h-6 w-6 rounded-full"
							onClick={(event) => {
								event.stopPropagation();
								onDeletePlaylist?.(
									groupId,
									displayTitle,
									historyRecords.map((record) => record.id),
								);
							}}
							size="icon"
							title={t("history.deletePlaylist")}
							type="button"
							variant="ghost"
						>
							<Trash2 className="h-3.5 w-3.5" />
						</Button>
					)}
				</div>
			</div>

			{!isExpanded && totalCount > 0 && (
				<Progress className="h-0.5 w-full" value={aggregatePercent} />
			)}

			<div
				className="grid overflow-hidden transition-[grid-template-rows] duration-300 ease-in-out"
				style={{
					gridTemplateRows: isExpanded ? "1fr" : "0fr",
				}}
			>
				<div className="min-h-0">
					{records.map((record) => (
						<div key={`${groupId}:${record.entryType}:${record.id}`}>
							<DownloadItem
								download={record}
								isSelected={selectedIds?.has(record.id) ?? false}
								onCancel={onCancel}
								onCopyUrl={onCopyUrl}
								onRemove={onRemove}
								onRetry={onRetry}
								onToggleSelect={onToggleSelect}
							/>
						</div>
					))}
				</div>
			</div>
		</div>
	);
}
