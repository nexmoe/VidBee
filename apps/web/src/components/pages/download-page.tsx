import type {
	DownloadTask,
	DownloadType,
	VideoInfo,
} from "@vidbee/downloader-core";
import { Badge } from "@vidbee/ui/components/ui/badge";
import { Button } from "@vidbee/ui/components/ui/button";
import { CardContent, CardHeader } from "@vidbee/ui/components/ui/card";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@vidbee/ui/components/ui/dialog";
import { Input } from "@vidbee/ui/components/ui/input";
import { Label } from "@vidbee/ui/components/ui/label";
import { Progress } from "@vidbee/ui/components/ui/progress";
import { ScrollArea } from "@vidbee/ui/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger } from "@vidbee/ui/components/ui/tabs";
import { cn } from "@vidbee/ui/lib/cn";
import { History as HistoryIcon, Plus } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { apiUrl, eventsUrl, orpcClient } from "../../lib/orpc-client";
import { AppShell } from "../layout/app-shell";

type StatusFilter = "active" | "all" | "completed" | "error";
type EntryType = "download" | "history";

interface DownloadEntry extends DownloadTask {
	entryType: EntryType;
}

const POLL_INTERVAL_MS = 2000;

const formatTimestamp = (value?: number): string => {
	if (!value) {
		return "";
	}

	return new Date(value).toLocaleString(undefined, {
		month: "numeric",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
};

const formatDuration = (seconds?: number): string => {
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

const toProgressValue = (task: DownloadTask): number => {
	return Math.max(0, Math.min(100, Math.round(task.progress?.percent ?? 0)));
};

export const DownloadPage = () => {
	const { t } = useTranslation();
	const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
	const [downloads, setDownloads] = useState<DownloadTask[]>([]);
	const [history, setHistory] = useState<DownloadTask[]>([]);
	const [isApiReachable, setIsApiReachable] = useState(false);
	const [apiConnectionMessage, setApiConnectionMessage] = useState("");
	const [url, setUrl] = useState("");
	const [downloadType, setDownloadType] = useState<DownloadType>("video");
	const [videoInfo, setVideoInfo] = useState<VideoInfo | null>(null);
	const [isDialogOpen, setIsDialogOpen] = useState(false);
	const [isLoadingInfo, setIsLoadingInfo] = useState(false);
	const [isCreatingDownload, setIsCreatingDownload] = useState(false);
	const [dialogMessage, setDialogMessage] = useState("");
	const [dialogErrorMessage, setDialogErrorMessage] = useState("");
	const urlInputId = useId();

	const statusLabelMap = useMemo(
		() => ({
			pending: t("download.downloadPending"),
			downloading: t("download.downloading"),
			completed: t("download.completed"),
			error: t("download.error"),
			cancelled: t("download.cancelled"),
		}),
		[t],
	);

	const statusBadgeVariantMap: Record<
		DownloadTask["status"],
		"default" | "destructive" | "outline" | "secondary"
	> = {
		pending: "outline",
		downloading: "secondary",
		completed: "default",
		error: "destructive",
		cancelled: "outline",
	};

	const refreshData = useCallback(async () => {
		try {
			const [downloadsResult, historyResult] = await Promise.all([
				orpcClient.downloads.list(),
				orpcClient.history.list(),
			]);

			setDownloads(downloadsResult.downloads);
			setHistory(historyResult.history);
			setIsApiReachable(true);
			setApiConnectionMessage("");
		} catch {
			setIsApiReachable(false);
			setApiConnectionMessage(
				t("web.apiDisconnected", {
					apiUrl: apiUrl || "http://localhost:3100",
				}),
			);
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

	const handleFetchVideoInfo = async () => {
		const trimmedUrl = url.trim();
		if (!trimmedUrl) {
			setDialogErrorMessage(t("errors.emptyUrl"));
			return;
		}

		setDialogMessage("");
		setDialogErrorMessage("");
		setVideoInfo(null);
		setIsLoadingInfo(true);

		try {
			const result = await orpcClient.videoInfo({ url: trimmedUrl });
			setVideoInfo(result.video);
			setDialogMessage(t("download.videoInfoUpdated"));
		} catch (error) {
			setDialogErrorMessage(
				error instanceof Error ? error.message : t("errors.fetchInfoFailed"),
			);
		} finally {
			setIsLoadingInfo(false);
		}
	};

	const handleCreateDownload = async () => {
		const trimmedUrl = url.trim();
		if (!trimmedUrl) {
			setDialogErrorMessage(t("errors.emptyUrl"));
			return;
		}

		setDialogMessage("");
		setDialogErrorMessage("");
		setIsCreatingDownload(true);

		try {
			await orpcClient.downloads.create({
				url: trimmedUrl,
				type: downloadType,
			});
			setDialogMessage(t("download.oneClickDownloadStarted"));
			setIsDialogOpen(false);
			setUrl("");
			setVideoInfo(null);
			await refreshData();
		} catch (error) {
			setDialogErrorMessage(
				error instanceof Error
					? error.message
					: t("notifications.downloadFailed"),
			);
		} finally {
			setIsCreatingDownload(false);
		}
	};

	const handleCancelDownload = async (id: string) => {
		try {
			await orpcClient.downloads.cancel({ id });
			await refreshData();
		} catch {
			setApiConnectionMessage(t("notifications.downloadFailed"));
		}
	};

	const mergedRecords = useMemo<DownloadEntry[]>(() => {
		const activeEntries: DownloadEntry[] = downloads.map((record) => ({
			...record,
			entryType: "download",
		}));
		const historyEntries: DownloadEntry[] = history.map((record) => ({
			...record,
			entryType: "history",
		}));
		return [...activeEntries, ...historyEntries].sort((left, right) => {
			const leftTime = left.completedAt ?? left.createdAt;
			const rightTime = right.completedAt ?? right.createdAt;
			return rightTime - leftTime;
		});
	}, [downloads, history]);

	const filteredRecords = useMemo(() => {
		return mergedRecords.filter((record) => {
			switch (statusFilter) {
				case "active":
					return record.status === "pending" || record.status === "downloading";
				case "completed":
					return record.status === "completed";
				case "error":
					return record.status === "error";
				default:
					return true;
			}
		});
	}, [mergedRecords, statusFilter]);

	const stats = useMemo(() => {
		return {
			total: mergedRecords.length,
			active: mergedRecords.filter(
				(record) =>
					record.status === "pending" || record.status === "downloading",
			).length,
			completed: mergedRecords.filter((record) => record.status === "completed")
				.length,
			error: mergedRecords.filter((record) => record.status === "error").length,
		};
	}, [mergedRecords]);

	const filters: Array<{ key: StatusFilter; label: string; count: number }> = [
		{ key: "all", label: t("download.all"), count: stats.total },
		{ key: "active", label: t("download.active"), count: stats.active },
		{
			key: "completed",
			label: t("download.completed"),
			count: stats.completed,
		},
		{ key: "error", label: t("download.error"), count: stats.error },
	];

	return (
		<AppShell page="download">
			<div className="flex h-full flex-col">
				<CardHeader className="z-50 gap-4 bg-background p-0 px-6 py-4 backdrop-blur">
					<div className="flex flex-wrap items-center justify-between gap-2 text-sm">
						<div className="flex flex-wrap items-center gap-2">
							{filters.map((filter) => {
								const isActive = statusFilter === filter.key;
								return (
									<Button
										className={
											isActive
												? "h-8 rounded-full px-3 shadow-sm"
												: "h-8 rounded-full border border-border/60 px-3"
										}
										key={filter.key}
										onClick={() => setStatusFilter(filter.key)}
										size="sm"
										variant={isActive ? "secondary" : "ghost"}
									>
										<span>{filter.label}</span>
										<span
											className={cn(
												"ml-1 min-w-5 rounded-full px-1 font-medium text-neutral-900 text-xs",
												isActive ? "bg-neutral-100" : "bg-neutral-200",
											)}
										>
											{filter.count}
										</span>
									</Button>
								);
							})}
						</div>
						<div className="flex items-center gap-2">
							<Dialog onOpenChange={setIsDialogOpen} open={isDialogOpen}>
								<DialogTrigger asChild>
									<Button className="h-9 rounded-full px-4" size="sm">
										<Plus className="h-4 w-4" />
										{t("download.downloadBtn")}
									</Button>
								</DialogTrigger>
								<DialogContent className="sm:max-w-2xl">
									<DialogHeader>
										<DialogTitle>{t("download.enterUrl")}</DialogTitle>
										<DialogDescription>
											{t("download.enterUrlDescription")}
										</DialogDescription>
									</DialogHeader>
									<div className="grid gap-4">
										<div className="grid gap-2">
											<Label htmlFor={urlInputId}>
												{t("download.enterUrl")}
											</Label>
											<Input
												id={urlInputId}
												onChange={(event) => setUrl(event.target.value)}
												placeholder={t("download.urlPlaceholder")}
												type="url"
												value={url}
											/>
										</div>

										<div className="grid gap-2">
											<Label>{t("download.selectDownloadType")}</Label>
											<Tabs
												onValueChange={(value) =>
													setDownloadType(value as DownloadType)
												}
												value={downloadType}
											>
												<TabsList className="grid w-full grid-cols-2">
													<TabsTrigger value="video">
														{t("download.video")}
													</TabsTrigger>
													<TabsTrigger value="audio">
														{t("download.audio")}
													</TabsTrigger>
												</TabsList>
											</Tabs>
										</div>

										{videoInfo ? (
											<div className="rounded-xl border border-border/60 bg-card/50 p-4">
												<p className="line-clamp-2 font-medium text-sm">
													{videoInfo.title}
												</p>
												<div className="mt-2 flex flex-wrap gap-2 text-muted-foreground text-xs">
													{videoInfo.duration ? (
														<span>{formatDuration(videoInfo.duration)}</span>
													) : null}
													<span>{videoInfo.formats.length} formats</span>
												</div>
											</div>
										) : null}

										{dialogMessage ? (
											<p className="font-medium text-primary text-sm">
												{dialogMessage}
											</p>
										) : null}
										{dialogErrorMessage ? (
											<p className="font-medium text-destructive text-sm">
												{dialogErrorMessage}
											</p>
										) : null}
									</div>
									<DialogFooter>
										<Button
											onClick={handleFetchVideoInfo}
											type="button"
											variant="outline"
										>
											{isLoadingInfo
												? t("download.loading")
												: t("download.fetch")}
										</Button>
										<Button
											disabled={isCreatingDownload}
											onClick={handleCreateDownload}
											type="button"
										>
											{isCreatingDownload
												? t("download.loading")
												: t("download.startDownload")}
										</Button>
									</DialogFooter>
								</DialogContent>
							</Dialog>
						</div>
					</div>
					{apiConnectionMessage ? (
						<p className="font-medium text-destructive text-sm">
							{apiConnectionMessage}
						</p>
					) : null}
				</CardHeader>

				<ScrollArea className="flex-1 overflow-y-auto">
					<CardContent className="w-full space-y-3 overflow-x-hidden p-0">
						{filteredRecords.length === 0 ? (
							<div className="mx-6 mb-4 flex flex-col items-center justify-center gap-3 rounded-xl border border-border/60 border-dashed px-6 py-10 text-center text-muted-foreground">
								<HistoryIcon className="h-10 w-10 opacity-50" />
								<p className="font-medium text-sm">{t("download.noItems")}</p>
							</div>
						) : (
							<div className="w-full pb-4">
								{filteredRecords.map((task) => {
									const progressValue = toProgressValue(task);
									const isActiveTask =
										task.status === "pending" || task.status === "downloading";
									const timestamp =
										task.completedAt ?? task.startedAt ?? task.createdAt;

									return (
										<div
											className="group mx-6 mt-3 rounded-xl border border-border/60 bg-card/35 px-4 py-3"
											key={`${task.entryType}:${task.id}`}
										>
											<div className="flex items-start justify-between gap-3">
												<div className="min-w-0 flex-1 space-y-2">
													<div className="flex flex-wrap items-center gap-2">
														<Badge variant={statusBadgeVariantMap[task.status]}>
															{statusLabelMap[task.status]}
														</Badge>
														<Badge variant="outline">{task.type}</Badge>
														<span className="text-muted-foreground text-xs">
															{formatTimestamp(timestamp)}
														</span>
													</div>
													<p className="truncate font-medium text-sm">
														{task.id}
													</p>
													<p className="line-clamp-2 text-muted-foreground text-xs">
														{task.url}
													</p>

													{isActiveTask ? (
														<div className="space-y-1 pt-1">
															<Progress
																className="h-1.5"
																value={progressValue}
															/>
															<p className="text-muted-foreground text-xs">
																{t("download.progress")}: {progressValue}%
																{task.progress?.currentSpeed
																	? ` · ${task.progress.currentSpeed}`
																	: ""}
															</p>
														</div>
													) : null}

													{task.error ? (
														<p className="font-medium text-destructive text-xs">
															{task.error}
														</p>
													) : null}
												</div>

												{task.entryType === "download" && isActiveTask ? (
													<Button
														onClick={() => handleCancelDownload(task.id)}
														size="sm"
														variant="outline"
													>
														{t("download.cancel")}
													</Button>
												) : null}
											</div>
										</div>
									);
								})}
							</div>
						)}
					</CardContent>
				</ScrollArea>
			</div>
		</AppShell>
	);
};
