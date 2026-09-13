import {
	getSubscriptionStatusMeta,
	resolveSubscriptionItemStatus,
	type SubscriptionItemQueueStatus,
} from "@vidbee/subscriptions-core/status";
import type {
	SubscriptionFeedItem,
	SubscriptionWithItems,
} from "@vidbee/subscriptions-core/types";
import { SUBSCRIPTION_DUPLICATE_FEED_ERROR } from "@vidbee/subscriptions-core/types";
import {
	type SubscriptionFormData,
	SubscriptionFormDialog,
} from "@vidbee/ui/components/subscription/subscription-form-dialog";
import { Badge } from "@vidbee/ui/components/ui/badge";
import { Button } from "@vidbee/ui/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@vidbee/ui/components/ui/card";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuTrigger,
} from "@vidbee/ui/components/ui/context-menu";
import {
	HoverCard,
	HoverCardContent,
	HoverCardTrigger,
} from "@vidbee/ui/components/ui/hover-card";
import { RemoteImage } from "@vidbee/ui/components/ui/remote-image";
import { ScrollArea } from "@vidbee/ui/components/ui/scroll-area";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@vidbee/ui/components/ui/tooltip";
import { cn } from "@vidbee/ui/lib/cn";
import {
	Download,
	Edit,
	ExternalLink,
	Plus,
	Power,
	RefreshCw,
	Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useWebSettings } from "../../hooks/use-web-settings";
import { logger } from "../../lib/logger";
import { orpcClient, subscriptionsClient } from "../../lib/orpc-client";
import { AppShell } from "../layout/app-shell";
import { ServerDirectoryDialog } from "../settings/server-directory-dialog";

const POLL_INTERVAL_MS = 5000;
const RSS_DOCS_URL = "https://vidbee.org/docs/rss/";

const subscriptionItemStatusLabels: Record<
	SubscriptionItemQueueStatus,
	string
> = {
	notQueued: "subscriptions.items.status.notQueued",
	queued: "subscriptions.items.status.queued",
	pending: "subscriptions.items.status.pending",
	downloading: "subscriptions.items.status.downloading",
	processing: "subscriptions.items.status.processing",
	completed: "subscriptions.items.status.completed",
	error: "subscriptions.items.status.error",
	cancelled: "subscriptions.items.status.cancelled",
};

const getErrorMessage = (error: unknown): string | undefined => {
	if (!error) {
		return undefined;
	}
	if (typeof error === "string") {
		return error;
	}
	if (typeof error === "object" && "message" in error) {
		const message = (error as { message?: unknown }).message;
		return typeof message === "string" ? message : undefined;
	}
	return undefined;
};

const isDuplicateFeedError = (error: unknown): boolean =>
	Boolean(getErrorMessage(error)?.includes(SUBSCRIPTION_DUPLICATE_FEED_ERROR));

const formatTimestamp = (timestamp?: number): string => {
	if (!timestamp) {
		return "";
	}
	const date = new Date(timestamp);
	const year = date.getFullYear();
	const month = `${date.getMonth() + 1}`.padStart(2, "0");
	const day = `${date.getDate()}`.padStart(2, "0");
	const hours = `${date.getHours()}`.padStart(2, "0");
	const minutes = `${date.getMinutes()}`.padStart(2, "0");
	return `${year}-${month}-${day} ${hours}:${minutes}`;
};

export const SubscriptionsPage = () => {
	const { t } = useTranslation();
	const { settings } = useWebSettings();
	const [subscriptions, setSubscriptions] = useState<SubscriptionWithItems[]>(
		[],
	);
	const [downloadById, setDownloadById] = useState<
		Map<string, { status: string }>
	>(new Map());
	const [addDialogOpen, setAddDialogOpen] = useState(false);
	const [selectedTab, setSelectedTab] = useState("");
	const [directoryDialogOpen, setDirectoryDialogOpen] = useState(false);
	const directoryPickerRef = useRef<((path: string | null) => void) | null>(
		null,
	);

	const refreshSubscriptions = useCallback(async () => {
		const result = await subscriptionsClient.list();
		setSubscriptions(result.items);
		try {
			const [active, history] = await Promise.all([
				orpcClient.downloads.list(),
				orpcClient.history.list(),
			]);
			const next = new Map<string, { status: string }>();
			for (const item of active.downloads) {
				next.set(item.id, { status: item.status });
			}
			for (const item of history.history) {
				next.set(item.id, { status: item.status });
			}
			setDownloadById(next);
		} catch {
			// Keep the last known download map if the queue is temporarily down.
		}
	}, []);

	useEffect(() => {
		void refreshSubscriptions().catch((error: unknown) => {
			logger.error("Failed to load subscriptions:", error);
		});
		const timer = window.setInterval(() => {
			void refreshSubscriptions().catch(() => undefined);
		}, POLL_INTERVAL_MS);
		return () => window.clearInterval(timer);
	}, [refreshSubscriptions]);

	const sortedSubscriptions = useMemo(
		() =>
			[...subscriptions].sort(
				(left, right) =>
					(right.updatedAt ?? right.createdAt ?? 0) -
					(left.updatedAt ?? left.createdAt ?? 0),
			),
		[subscriptions],
	);

	useEffect(() => {
		if (!selectedTab && sortedSubscriptions.length > 0) {
			setSelectedTab(sortedSubscriptions[0].id);
			return;
		}
		if (
			selectedTab &&
			!sortedSubscriptions.some(
				(subscription) => subscription.id === selectedTab,
			)
		) {
			setSelectedTab(sortedSubscriptions[0]?.id ?? "");
		}
	}, [selectedTab, sortedSubscriptions]);

	const pickDirectory = useCallback(async () => {
		return new Promise<string | null>((resolve) => {
			directoryPickerRef.current = resolve;
			setDirectoryDialogOpen(true);
		});
	}, []);

	const handleDirectoryDialogOpenChange = (open: boolean) => {
		setDirectoryDialogOpen(open);
		if (!open && directoryPickerRef.current) {
			directoryPickerRef.current(null);
			directoryPickerRef.current = null;
		}
	};

	const resolveFeed = useCallback(async (url: string) => {
		return subscriptionsClient.resolve({ rawUrl: url });
	}, []);

	const handleCreateSubscription = useCallback(
		async (data: SubscriptionFormData) => {
			if (!data.url) {
				toast.error(t("subscriptions.notifications.missingUrl"));
				return;
			}
			try {
				const resolved = await resolveFeed(data.url);
				const created = await subscriptionsClient.add({
					sourceUrl: resolved.sourceUrl,
					feedUrl: resolved.feedUrl,
					platform: resolved.platform,
					keywords: data.keywords,
					tags: data.tags,
					onlyDownloadLatest: data.onlyDownloadLatest,
					autoDownload: data.autoDownload,
					downloadDirectory: data.downloadDirectory,
					namingTemplate: data.namingTemplate,
					enabled: data.enabled,
				});
				void subscriptionsClient
					.refresh({ id: created.id })
					.catch(() => undefined);
				toast.success(t("subscriptions.notifications.created"));
				setAddDialogOpen(false);
				await refreshSubscriptions();
				setSelectedTab(created.id);
			} catch (error) {
				logger.error("Failed to create subscription:", error);
				toast.error(
					isDuplicateFeedError(error)
						? t("subscriptions.notifications.duplicateUrl")
						: t("subscriptions.notifications.createError"),
				);
			}
		},
		[refreshSubscriptions, resolveFeed, t],
	);

	const handleUpdateSubscription = useCallback(
		async (id: string, data: SubscriptionFormData) => {
			try {
				const payload: Parameters<typeof subscriptionsClient.update>[0] = {
					id,
					keywords: data.keywords,
					tags: data.tags,
					onlyDownloadLatest: data.onlyDownloadLatest,
					autoDownload: data.autoDownload,
					downloadDirectory: data.downloadDirectory,
					namingTemplate: data.namingTemplate,
					enabled: data.enabled,
				};
				if (data.url) {
					const resolved = await resolveFeed(data.url);
					payload.sourceUrl = resolved.sourceUrl;
					payload.feedUrl = resolved.feedUrl;
					payload.platform = resolved.platform;
				}
				await subscriptionsClient.update(payload);
				await subscriptionsClient.refresh({ id });
				toast.success(t("subscriptions.notifications.updated"));
				await refreshSubscriptions();
			} catch (error) {
				logger.error("Failed to update subscription:", error);
				toast.error(
					isDuplicateFeedError(error)
						? t("subscriptions.notifications.duplicateUrl")
						: t("subscriptions.notifications.createError"),
				);
			}
		},
		[refreshSubscriptions, resolveFeed, t],
	);

	const displayedSubscriptions = useMemo(
		() =>
			sortedSubscriptions.filter(
				(subscription) => subscription.id === selectedTab,
			),
		[selectedTab, sortedSubscriptions],
	);

	return (
		<AppShell page="subscriptions">
			<div className="relative flex h-full w-full flex-col">
				<div className="flex flex-row pr-6 pb-6 pl-6">
					<ScrollArea
						className="min-w-0 flex-1"
						orientation="horizontal"
						viewportClassName="h-auto"
					>
						<div className="flex h-auto w-auto justify-start">
							{sortedSubscriptions.map((subscription) => (
								<SubscriptionTab
									isActive={subscription.id === selectedTab}
									key={subscription.id}
									onRefresh={async () => {
										await subscriptionsClient.refresh({ id: subscription.id });
										toast.success(
											t("subscriptions.notifications.refreshStarted"),
										);
										await refreshSubscriptions();
									}}
									onRemove={async () => {
										await subscriptionsClient.remove({ id: subscription.id });
										toast.success(t("subscriptions.notifications.removed"));
										await refreshSubscriptions();
									}}
									onSelect={() => setSelectedTab(subscription.id)}
									onUpdate={(data) =>
										handleUpdateSubscription(subscription.id, data)
									}
									pickDirectory={pickDirectory}
									resolveFeed={resolveFeed}
									settings={settings}
									subscription={subscription}
								/>
							))}
						</div>
					</ScrollArea>
					<Button
						className="flex h-auto w-20 shrink-0 grow-0 flex-col items-center gap-1 rounded-2xl bg-transparent px-2 py-2 transition-all hover:bg-neutral-100 hover:opacity-80"
						onClick={() => setAddDialogOpen(true)}
						variant="ghost"
					>
						<div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-2 border-muted-foreground/40 border-dashed transition-colors">
							<Plus className="h-5 w-5 text-muted-foreground" />
						</div>
						<div className="flex w-full flex-col items-center text-center">
							<span className="w-full truncate font-medium text-xs">
								{t("subscriptions.add.title")}
							</span>
						</div>
					</Button>
				</div>

				<ScrollArea className="overflow-y-auto">
					<div className="relative space-y-8 p-6 pt-0">
						<section className="space-y-4">
							{sortedSubscriptions.length === 0 || !selectedTab ? (
								<div className="py-12 text-center text-muted-foreground text-sm">
									{t("subscriptions.empty")}
								</div>
							) : (
								<div className="space-y-3">
									{displayedSubscriptions.map((subscription) => (
										<SubscriptionCard
											downloadById={downloadById}
											key={subscription.id}
											onQueueItem={async (item) => {
												if (item.addedToQueue) {
													toast.info(
														t("subscriptions.notifications.itemAlreadyQueued"),
													);
													return;
												}
												try {
													const queued = await subscriptionsClient.itemsQueue({
														subscriptionId: subscription.id,
														itemId: item.id,
													});
													if (queued.queued) {
														toast.success(
															t("subscriptions.notifications.itemQueued"),
														);
														await refreshSubscriptions();
														return;
													}
													toast.info(
														t("subscriptions.notifications.itemAlreadyQueued"),
													);
												} catch (error) {
													logger.error(
														"Failed to queue subscription item:",
														error,
													);
													toast.error(
														t("subscriptions.notifications.queueError"),
													);
												}
											}}
											subscription={subscription}
										/>
									))}
								</div>
							)}
						</section>

						<Card className="border-primary/20 bg-primary/5">
							<CardHeader>
								<CardTitle className="flex items-center gap-2">
									{t("subscriptions.rssHub.title")}
								</CardTitle>
								<CardDescription>
									{t("subscriptions.rssHub.description")}
								</CardDescription>
							</CardHeader>
							<CardContent>
								<Button
									className="gap-2"
									onClick={() =>
										window.open(RSS_DOCS_URL, "_blank", "noopener,noreferrer")
									}
									size="sm"
									variant="secondary"
								>
									{t("subscriptions.rssHub.openDocs")}
								</Button>
							</CardContent>
						</Card>
					</div>
				</ScrollArea>

				<SubscriptionFormDialog
					downloadPath={settings.downloadPath}
					mode="add"
					onClose={() => setAddDialogOpen(false)}
					onOpenRssDocs={() => {
						window.open(RSS_DOCS_URL, "_blank", "noopener,noreferrer");
					}}
					onResolveFeed={resolveFeed}
					onSave={handleCreateSubscription}
					onSelectDirectory={pickDirectory}
					onlyLatestDefault={settings.subscriptionOnlyLatestDefault}
					open={addDialogOpen}
				/>
				<ServerDirectoryDialog
					description={t("subscriptions.fields.customDirectory")}
					initialPath={settings.downloadPath}
					onOpenChange={handleDirectoryDialogOpenChange}
					onSelect={(path) => {
						directoryPickerRef.current?.(path);
						directoryPickerRef.current = null;
					}}
					open={directoryDialogOpen}
					title={t("subscriptions.actions.selectDirectory")}
				/>
			</div>
		</AppShell>
	);
};

interface SubscriptionTabProps {
	subscription: SubscriptionWithItems;
	isActive: boolean;
	onRefresh: () => Promise<void>;
	onRemove: () => Promise<void>;
	onSelect: () => void;
	onUpdate: (data: SubscriptionFormData) => Promise<void>;
	pickDirectory: () => Promise<string | null>;
	resolveFeed: (url: string) => Promise<unknown>;
	settings: { downloadPath: string; subscriptionOnlyLatestDefault: boolean };
}

const SubscriptionTab = ({
	subscription,
	isActive,
	onRefresh,
	onRemove,
	onSelect,
	onUpdate,
	pickDirectory,
	resolveFeed,
	settings,
}: SubscriptionTabProps) => {
	const { t } = useTranslation();
	const [editOpen, setEditOpen] = useState(false);
	const statusMeta = getSubscriptionStatusMeta(
		subscription.status,
		subscription.enabled,
	);
	const statusDescription =
		subscription.status === "failed" && subscription.lastError
			? subscription.lastError
			: t(statusMeta.label);
	const lastUpdatedTimestamp =
		subscription.lastCheckedAt ??
		subscription.updatedAt ??
		subscription.createdAt ??
		null;
	const lastUpdatedLabel = lastUpdatedTimestamp
		? formatTimestamp(lastUpdatedTimestamp)
		: t("subscriptions.never");

	return (
		<>
			<ContextMenu>
				<HoverCard closeDelay={0} openDelay={0}>
					<ContextMenuTrigger asChild>
						<HoverCardTrigger asChild>
							<button
								className={cn(
									"flex h-auto w-20 shrink-0 grow-0 flex-col items-center gap-1 rounded-2xl px-2 py-2 transition-all hover:opacity-80",
									isActive && "bg-muted/45",
								)}
								onClick={onSelect}
								type="button"
							>
								<div className="relative h-12 w-12 shrink-0 overflow-hidden transition-colors">
									<RemoteImage
										alt={
											subscription.title || t("subscriptions.labels.unknown")
										}
										className="h-full w-full overflow-hidden rounded-full object-cover"
										src={subscription.coverUrl}
									/>
									<span
										className={cn(
											"absolute -right-0.5 -bottom-0.5 h-3.5 w-3.5 rounded-full border-2 border-background transition-colors",
											statusMeta.dotClass,
										)}
									/>
								</div>
								<div className="flex w-full flex-col items-center text-center">
									<span className="w-full truncate font-medium text-xs">
										{subscription.title || t("subscriptions.labels.unknown")}
									</span>
								</div>
							</button>
						</HoverCardTrigger>
					</ContextMenuTrigger>
					<HoverCardContent className="max-w-xs space-y-1">
						<p className="font-semibold text-sm">
							{subscription.title || t("subscriptions.labels.unknown")}
						</p>
						<p className="text-xs">{statusDescription}</p>
						<p className="text-xs">
							{t("subscriptions.status.tooltip.updatedAt", {
								time: lastUpdatedLabel,
							})}
						</p>
					</HoverCardContent>
				</HoverCard>
				<ContextMenuContent>
					<ContextMenuItem onClick={() => void onRefresh()}>
						<RefreshCw className="h-4 w-4" />
						{t("subscriptions.actions.refresh")}
					</ContextMenuItem>
					<ContextMenuItem onClick={() => setEditOpen(true)}>
						<Edit className="h-4 w-4" />
						{t("subscriptions.actions.edit")}
					</ContextMenuItem>
					<ContextMenuItem
						onClick={() => void onUpdate({ enabled: !subscription.enabled })}
					>
						<Power className="h-4 w-4" />
						{subscription.enabled
							? t("subscriptions.actions.disable")
							: t("subscriptions.actions.enable")}
					</ContextMenuItem>
					<ContextMenuSeparator />
					<ContextMenuItem
						onClick={() => void onRemove()}
						variant="destructive"
					>
						<Trash2 className="h-4 w-4" />
						{t("subscriptions.actions.remove")}
					</ContextMenuItem>
				</ContextMenuContent>
			</ContextMenu>
			<SubscriptionFormDialog
				downloadPath={settings.downloadPath}
				mode="edit"
				onClose={() => setEditOpen(false)}
				onResolveFeed={resolveFeed}
				onSave={async (data) => {
					await onUpdate(data);
					setEditOpen(false);
				}}
				onSelectDirectory={pickDirectory}
				onlyLatestDefault={settings.subscriptionOnlyLatestDefault}
				open={editOpen}
				subscription={subscription}
			/>
		</>
	);
};

const SubscriptionCard = ({
	downloadById,
	subscription,
	onQueueItem,
}: {
	downloadById: ReadonlyMap<string, { status: string }>;
	subscription: SubscriptionWithItems;
	onQueueItem: (item: SubscriptionFeedItem) => Promise<void>;
}) => {
	const { t } = useTranslation();
	const feedItems = subscription.items ?? [];

	if (feedItems.length === 0) {
		return (
			<div className="py-12 text-center text-muted-foreground text-sm">
				{t("subscriptions.items.empty")}
			</div>
		);
	}

	return (
		<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
			{feedItems.map((item) => {
				const itemStatus = resolveSubscriptionItemStatus(item, downloadById);
				const hasResolvedDownloadStatus =
					item.addedToQueue &&
					itemStatus !== "queued" &&
					itemStatus !== "notQueued";
				const badgeLabel = item.addedToQueue
					? t("subscriptions.items.status.queued")
					: t("subscriptions.items.status.notQueued");
				const tooltipLabel = item.addedToQueue
					? hasResolvedDownloadStatus
						? t("subscriptions.items.tooltip.downloadStatus", {
								status: t(subscriptionItemStatusLabels[itemStatus]),
							})
						: t("subscriptions.items.tooltip.downloadPending")
					: t("subscriptions.items.tooltip.notQueued");
				const badgeClass = item.addedToQueue ? "bg-emerald-500" : "bg-black/70";
				return (
					<ContextMenu key={`${subscription.id}-${item.id}`}>
						<ContextMenuTrigger asChild>
							<article className="group transition-all">
								<div className="relative aspect-video w-full overflow-hidden rounded-2xl bg-muted">
									{item.thumbnail ? (
										<RemoteImage
											alt={item.title}
											className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
											src={item.thumbnail}
										/>
									) : (
										<div className="absolute inset-0 flex items-center justify-center text-muted-foreground text-sm">
											{t("subscriptions.labels.noThumbnail")}
										</div>
									)}
									<div className="pointer-events-none absolute inset-0 bg-linear-to-t from-black/70 via-black/5 to-transparent" />
									<div className="absolute top-3 left-3 flex items-center gap-2 rounded-full bg-black/60 py-1 pr-3 pl-1 font-medium text-white text-xs backdrop-blur">
										{subscription.coverUrl ? (
											<div className="h-6 w-6 overflow-hidden rounded-full border border-white/40">
												<RemoteImage
													alt={
														subscription.title ||
														t("subscriptions.labels.unknown")
													}
													className="h-full w-full object-cover"
													src={subscription.coverUrl}
												/>
											</div>
										) : (
											<div className="flex h-6 w-6 items-center justify-center rounded-full border border-white/40 bg-white/10 font-semibold text-[10px] text-white uppercase">
												{(
													subscription.title ||
													t("subscriptions.labels.unknown")
												).slice(0, 1)}
											</div>
										)}
										<span className="max-w-40 truncate text-xs">
											{subscription.title || t("subscriptions.labels.unknown")}
										</span>
									</div>
									<div className="absolute bottom-3 left-3 font-medium text-white text-xs">
										{formatTimestamp(item.publishedAt)}
									</div>
									<Tooltip>
										<TooltipTrigger asChild>
											<Badge
												className={cn(
													"absolute right-3 bottom-3 rounded-full text-white text-xs backdrop-blur",
													badgeClass,
												)}
												variant="secondary"
											>
												{badgeLabel}
											</Badge>
										</TooltipTrigger>
										<TooltipContent>{tooltipLabel}</TooltipContent>
									</Tooltip>
								</div>
								<div className="flex flex-col gap-4 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
									<p
										className="font-semibold text-base text-card-foreground leading-snug"
										title={item.title}
									>
										{item.title}
									</p>
									<Button
										className="rounded-full px-4"
										onClick={() =>
											window.open(item.url, "_blank", "noopener,noreferrer")
										}
										size="sm"
										title={t("subscriptions.items.actions.open")}
										variant="secondary"
									>
										<ExternalLink className="h-4 w-4" />
									</Button>
								</div>
							</article>
						</ContextMenuTrigger>
						<ContextMenuContent>
							<ContextMenuItem
								disabled={item.addedToQueue}
								onClick={() => void onQueueItem(item)}
							>
								<Download className="h-4 w-4" />
								{t("subscriptions.items.actions.queue")}
							</ContextMenuItem>
							<ContextMenuItem
								onClick={() =>
									window.open(item.url, "_blank", "noopener,noreferrer")
								}
							>
								<ExternalLink className="h-4 w-4" />
								{t("subscriptions.items.actions.open")}
							</ContextMenuItem>
						</ContextMenuContent>
					</ContextMenu>
				);
			})}
		</div>
	);
};
