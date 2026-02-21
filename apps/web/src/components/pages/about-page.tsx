import { Badge } from "@vidbee/ui/components/ui/badge";
import { Button } from "@vidbee/ui/components/ui/button";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "@vidbee/ui/components/ui/card";
import { Progress } from "@vidbee/ui/components/ui/progress";
import { Switch } from "@vidbee/ui/components/ui/switch";
import type { LucideIcon } from "lucide-react";
import {
	Download,
	Facebook,
	FileText,
	Github,
	Link as LinkIcon,
	MessageSquare,
	RefreshCw,
	Twitter,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { orpcClient } from "../../lib/orpc-client";
import { AppShell } from "../layout/app-shell";

interface AboutResource {
	icon: LucideIcon;
	label: string;
	description?: string;
	actionLabel: string;
	href?: string;
}

type LatestVersionState =
	| { status: "available"; version: string }
	| { status: "uptodate"; version: string }
	| { status: "error"; error?: string }
	| null;

const AUTO_UPDATE_KEY = "vidbee.web.auto-update";
const PREVIEW_CHANNEL_KEY = "vidbee.web.preview-channel";
const SHARE_TARGET_URL = "https://vidbee.org";

const readStoredBoolean = (key: string, fallbackValue: boolean): boolean => {
	if (typeof window === "undefined") {
		return fallbackValue;
	}

	const value = window.localStorage.getItem(key);
	if (value === "true") {
		return true;
	}
	if (value === "false") {
		return false;
	}

	return fallbackValue;
};

const writeStoredBoolean = (key: string, value: boolean): void => {
	if (typeof window === "undefined") {
		return;
	}

	window.localStorage.setItem(key, value ? "true" : "false");
};

export const AboutPage = () => {
	const { t } = useTranslation();
	const [appVersion, setAppVersion] = useState("-");
	const [osVersion, setOsVersion] = useState("-");
	const [autoUpdate, setAutoUpdate] = useState(() =>
		readStoredBoolean(AUTO_UPDATE_KEY, true),
	);
	const [previewChannel, setPreviewChannel] = useState(() =>
		readStoredBoolean(PREVIEW_CHANNEL_KEY, false),
	);
	const [latestVersionState, setLatestVersionState] =
		useState<LatestVersionState>(null);
	const [updateDownloadProgress] = useState<number | null>(null);

	useEffect(() => {
		const loadStatus = async () => {
			try {
				const result = await orpcClient.status();
				setAppVersion(result.version || "-");
				setOsVersion(window.navigator.userAgent || "-");
			} catch {
				setAppVersion("-");
				setOsVersion("-");
			}
		};

		void loadStatus();
	}, []);

	const setAutoUpdateValue = (value: boolean) => {
		setAutoUpdate(value);
		writeStoredBoolean(AUTO_UPDATE_KEY, value);
	};

	const setPreviewChannelValue = (value: boolean) => {
		setPreviewChannel(value);
		writeStoredBoolean(PREVIEW_CHANNEL_KEY, value);
	};

	const openShareUrl = useCallback((url: string) => {
		if (typeof window === "undefined") {
			return;
		}

		window.open(url, "_blank", "noopener,noreferrer");
	}, []);

	const handleGoToDownload = () => {
		openShareUrl("https://vidbee.org/download/");
	};

	const handleCheckForUpdates = async () => {
		try {
			const result = await orpcClient.status();
			setLatestVersionState({
				status: "uptodate",
				version: result.version || appVersion,
			});
		} catch (error) {
			setLatestVersionState({
				status: "error",
				error: error instanceof Error ? error.message : "Unknown error",
			});
		}
	};

	const shareLinks = useMemo(() => {
		const encodedUrl = encodeURIComponent(SHARE_TARGET_URL);
		const encodedText = encodeURIComponent(
			`${t("about.description")} @nexmoex`,
		);

		return {
			facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`,
			twitter: `https://twitter.com/intent/tweet?url=${encodedUrl}&text=${encodedText}`,
		};
	}, [t]);

	const handleShareTwitter = () => {
		openShareUrl(shareLinks.twitter);
	};

	const handleShareFacebook = () => {
		openShareUrl(shareLinks.facebook);
	};

	const handleCopyShareLink = async () => {
		if (typeof navigator === "undefined") {
			return;
		}

		try {
			await navigator.clipboard.writeText(SHARE_TARGET_URL);
		} catch {
			// no-op
		}
	};

	const latestVersionBadgeText =
		latestVersionState &&
		latestVersionState.status !== "error" &&
		latestVersionState.version
			? t("about.latestVersionBadge", { version: latestVersionState.version })
			: null;
	const latestVersionStatusKey = latestVersionState
		? `about.latestVersionStatus.${latestVersionState.status}`
		: null;
	const latestVersionStatusClass =
		latestVersionState?.status === "available"
			? "text-primary"
			: latestVersionState?.status === "error"
				? "text-destructive"
				: "text-muted-foreground";
	const latestVersionStatusText = latestVersionStatusKey
		? t(latestVersionStatusKey)
		: null;

	const aboutResources = useMemo<AboutResource[]>(
		() => [
			{
				icon: LinkIcon,
				label: t("about.resources.website"),
				description: t("about.resources.websiteDescription"),
				actionLabel: t("about.actions.visit"),
				href: "https://vidbee.org/",
			},
			{
				icon: FileText,
				label: t("about.resources.changelog"),
				description: t("about.resources.changelogDescription"),
				actionLabel: t("about.actions.view"),
				href: "https://github.com/nexmoe/VidBee/releases",
			},
		],
		[t],
	);

	return (
		<AppShell page="about">
			<div className="h-full bg-background">
				<div className="container mx-auto max-w-5xl space-y-6 p-6">
					<Card>
						<CardContent className="pt-6">
							<div className="flex flex-col gap-4">
								<div className="flex items-center gap-4">
									<img
										alt="VidBee"
										className="h-18 w-18 rounded-2xl"
										src="/app-icon.png"
									/>
									<div className="flex-1 space-y-2">
										<div className="flex items-center justify-between gap-4">
											<div className="flex items-center gap-3">
												<h2 className="font-semibold text-2xl leading-tight">
													{t("about.appName")}
												</h2>
												<Badge variant="secondary">
													{t("about.versionLabel", {
														version: appVersion || "-",
													})}
												</Badge>
												{latestVersionState ? (
													<div className="flex flex-wrap items-center gap-2">
														{latestVersionBadgeText ? (
															<Badge variant="outline">
																{latestVersionBadgeText}
															</Badge>
														) : null}
														{latestVersionStatusText ? (
															<span
																className={`text-sm ${latestVersionStatusClass}`}
															>
																{latestVersionStatusText}
															</span>
														) : null}
													</div>
												) : null}
											</div>
											<div className="flex flex-wrap items-center gap-2">
												<Button asChild size="sm" variant="outline">
													<a
														aria-label={t("about.actions.openRepo")}
														href="https://github.com/nexmoe/vidbee"
														rel="noreferrer"
														target="_blank"
													>
														<Github className="h-3.5 w-3.5" />
													</a>
												</Button>
												{latestVersionState?.status === "available" ? (
													<Button
														className="gap-2"
														onClick={handleGoToDownload}
														size="sm"
														variant="default"
													>
														<Download className="h-3.5 w-3.5" />
														{t("about.actions.goToDownload")}
													</Button>
												) : null}
												<Button
													className="gap-2"
													onClick={handleCheckForUpdates}
													size="sm"
												>
													<RefreshCw className="h-3.5 w-3.5" />
													{t("about.actions.checkUpdates")}
												</Button>
											</div>
										</div>
										<p className="text-muted-foreground text-sm">
											{t("about.description")}
										</p>
									</div>
								</div>
							</div>
							{updateDownloadProgress !== null ? (
								<div className="flex flex-col gap-3 pt-4">
									<div className="w-full space-y-2">
										<div className="flex items-center justify-between gap-2">
											<span className="text-muted-foreground text-sm">
												{t("about.downloadingUpdate")}
											</span>
											<span className="font-medium text-sm">
												{updateDownloadProgress.toFixed(1)}%
											</span>
										</div>
										<Progress className="h-2" value={updateDownloadProgress} />
									</div>
								</div>
							) : null}
							<div className="flex items-center justify-between gap-4 pt-6">
								<div className="space-y-1">
									<p className="font-medium leading-none">
										{t("about.autoUpdateTitle")}
									</p>
									<p className="text-muted-foreground text-sm">
										{t("about.autoUpdateDescription")}
									</p>
								</div>
								<Switch
									checked={autoUpdate}
									onCheckedChange={setAutoUpdateValue}
								/>
							</div>
							<div className="flex items-center justify-between gap-4 pt-6">
								<div className="space-y-1">
									<p className="font-medium leading-none">
										{t("about.betaProgramTitle")}
									</p>
									<p className="text-muted-foreground text-sm">
										{t("about.betaProgramDescription")}
									</p>
								</div>
								<Switch
									checked={previewChannel}
									onCheckedChange={setPreviewChannelValue}
								/>
							</div>
							<p className="text-muted-foreground text-xs">{osVersion}</p>
						</CardContent>
					</Card>

					<Card>
						<CardHeader>
							<CardTitle>{t("about.shareTitle")}</CardTitle>
						</CardHeader>
						<CardContent className="space-y-4">
							<div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
								<p className="text-muted-foreground text-sm md:max-w-md">
									{t("about.shareSupport")}
								</p>
								<div className="flex flex-wrap gap-2">
									<Button
										className="gap-2"
										onClick={handleShareTwitter}
										size="sm"
										variant="outline"
									>
										<Twitter className="h-4 w-4" />
										{t("about.shareActions.twitter")}
									</Button>
									<Button
										className="gap-2"
										onClick={handleShareFacebook}
										size="sm"
										variant="outline"
									>
										<Facebook className="h-4 w-4" />
										{t("about.shareActions.facebook")}
									</Button>
									<Button
										className="gap-2"
										onClick={handleCopyShareLink}
										size="sm"
										variant="secondary"
									>
										<LinkIcon className="h-4 w-4" />
										{t("about.shareActions.copy")}
									</Button>
								</div>
							</div>
							<div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
								<p className="text-muted-foreground text-sm md:max-w-md">
									{t("about.followAuthorSupport")}
								</p>
								<div className="flex flex-wrap gap-2">
									<Button
										className="gap-2"
										onClick={() => openShareUrl("https://x.com/nexmoex")}
										size="sm"
										variant="outline"
									>
										<Twitter className="h-4 w-4" />
										{t("about.followAuthorActions.follow")}
									</Button>
								</div>
							</div>
						</CardContent>
					</Card>

					<Card>
						<CardContent className="p-0">
							<div className="flex flex-col divide-y">
								<div className="flex items-center justify-between gap-4 px-6 py-4">
									<div className="flex items-center gap-4">
										<div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted/60">
											<MessageSquare className="h-5 w-5 text-muted-foreground" />
										</div>
										<div className="space-y-1">
											<p className="font-medium leading-none">
												{t("about.resources.feedback")}
											</p>
											<p className="text-muted-foreground text-sm">
												{t("about.resources.feedbackDescription")}
											</p>
										</div>
									</div>
									<div className="flex flex-wrap gap-2">
										<Button
											asChild
											className="gap-2"
											size="sm"
											variant="outline"
										>
											<a
												href="https://github.com/nexmoe/VidBee/issues/new/choose"
												rel="noreferrer"
												target="_blank"
											>
												<Github className="h-4 w-4" />
												{t("about.resources.githubIssues")}
											</a>
										</Button>
										<Button
											asChild
											className="gap-2"
											size="sm"
											variant="outline"
										>
											<a
												href="https://x.com/intent/tweet?text=%40nexmoex%20VidBee"
												rel="noreferrer"
												target="_blank"
											>
												<Twitter className="h-4 w-4" />
												{t("about.resources.xFeedback")}
											</a>
										</Button>
										<Button
											asChild
											className="gap-2"
											size="sm"
											variant="outline"
										>
											<a
												href="https://discord.gg/uBqXV6QPdm"
												rel="noreferrer"
												target="_blank"
											>
												<MessageSquare className="h-4 w-4" />
												{t("about.resources.discord")}
											</a>
										</Button>
									</div>
								</div>

								{aboutResources.map((resource) => {
									const Icon = resource.icon;
									return (
										<div
											className="flex items-center justify-between gap-4 px-6 py-4"
											key={resource.label}
										>
											<div className="flex items-center gap-4">
												<div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted/60">
													<Icon className="h-5 w-5 text-muted-foreground" />
												</div>
												<div className="space-y-1">
													<p className="font-medium leading-none">
														{resource.label}
													</p>
													{resource.description ? (
														<p className="text-muted-foreground text-sm">
															{resource.description}
														</p>
													) : null}
												</div>
											</div>
											<Button asChild size="sm" variant="outline">
												<a
													href={resource.href}
													rel="noreferrer"
													target="_blank"
												>
													{resource.actionLabel}
												</a>
											</Button>
										</div>
									);
								})}
							</div>
						</CardContent>
					</Card>
				</div>
			</div>
		</AppShell>
	);
};
