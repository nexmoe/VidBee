import { Badge } from "@vidbee/ui/components/ui/badge";
import { Button } from "@vidbee/ui/components/ui/button";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "@vidbee/ui/components/ui/card";
import { DownloadEngineRow } from "@vidbee/ui/components/ui/download-engine-row";
import { FeedbackLinkButtons } from "@vidbee/ui/components/ui/feedback-link-buttons";
import { ItemSeparator } from "@vidbee/ui/components/ui/item";
import {
	OTHER_PRODUCTS,
	OtherProductCard,
} from "@vidbee/ui/components/ui/other-product-card";
import { Progress } from "@vidbee/ui/components/ui/progress";
import type { LucideIcon } from "lucide-react";
import {
	Download,
	Facebook,
	FileText,
	Github,
	Link as LinkIcon,
	Mail,
	MessageSquare,
	RefreshCw,
	Twitter,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { orpcClient } from "../../lib/orpc-client";
import { AppShell } from "../layout/app-shell";

interface AboutResource {
	icon: LucideIcon;
	label: string;
	description?: string;
	actionLabel: string;
	href?: string;
	external?: boolean;
}

const SUPPORT_EMAIL = "team@vidbee.org";

type LatestVersionState =
	| { status: "available"; version: string }
	| { status: "uptodate"; version: string }
	| { status: "error"; error?: string }
	| null;

const SHARE_TARGET_URL = "https://vidbee.org";
const APP_VERSION = __APP_VERSION__;
const GITHUB_RELEASES_API =
	"https://api.github.com/repos/nexmoe/VidBee/releases/latest";

type EngineStatus = {
	error: string | null;
	ffmpegVersion: string | null;
	latestYtDlpVersion: string | null;
	nodeVersion: string;
	state: string;
	ytDlpPath: string | null;
	ytDlpVersion: string | null;
};

const compareAppVersions = (left: string, right: string): number => {
	const parse = (value: string): number[] =>
		value
			.replace(/^v/i, "")
			.split(".")
			.map((part) => {
				const n = Number.parseInt(part, 10);
				return Number.isFinite(n) ? n : 0;
			});
	const leftParts = parse(left);
	const rightParts = parse(right);
	const length = Math.max(leftParts.length, rightParts.length);
	for (let index = 0; index < length; index += 1) {
		const diff = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
		if (diff !== 0) {
			return diff;
		}
	}
	return 0;
};

export const AboutPage = () => {
	const { t } = useTranslation();
	const [appVersion, setAppVersion] = useState(APP_VERSION);
	const [osVersion, setOsVersion] = useState("-");
	const [serverDownloadDir, setServerDownloadDir] = useState("");
	const [serverDataDir, setServerDataDir] = useState("");
	const [serverDbPath, setServerDbPath] = useState("");
	const [engineStatus, setEngineStatus] = useState<EngineStatus | null>(null);
	const [engineBusy, setEngineBusy] = useState(false);
	const [latestVersionState, setLatestVersionState] =
		useState<LatestVersionState>(null);
	const [updateDownloadProgress] = useState<number | null>(null);

	useEffect(() => {
		const loadStatus = async () => {
			try {
				const status = await orpcClient.status();
				setAppVersion(status.version || APP_VERSION);
				setOsVersion(window.navigator.userAgent || "-");
				setServerDownloadDir(status.downloadDir ?? "");
				setServerDataDir(status.dataDir ?? "");
				setServerDbPath(status.dbPath ?? "");
			} catch {
				setOsVersion("-");
			}
			try {
				setEngineStatus(await orpcClient.engines.status());
			} catch {
				setEngineStatus(null);
			}
		};

		void loadStatus();
	}, []);

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
			toast.info(t("about.notifications.checkingUpdates"));
			const [status, engines] = await Promise.all([
				orpcClient.status(),
				orpcClient.engines.check().catch(() => null),
			]);
			const currentVersion = status.version || appVersion;
			setAppVersion(currentVersion);
			if (engines) {
				setEngineStatus(engines);
			}

			let latestTag: string | null = null;
			try {
				const response = await fetch(GITHUB_RELEASES_API, {
					headers: { Accept: "application/vnd.github+json" },
				});
				if (response.ok) {
					const payload = (await response.json()) as { tag_name?: string };
					latestTag = payload.tag_name?.trim() || null;
				}
			} catch {
				latestTag = null;
			}

			if (latestTag && compareAppVersions(currentVersion, latestTag) < 0) {
				toast.success(
					t("about.notifications.updateAvailable", { version: latestTag }),
				);
				setLatestVersionState({
					status: "available",
					version: latestTag.replace(/^v/i, ""),
				});
				return;
			}

			toast.success(t("about.notifications.noUpdatesAvailable"));
			setLatestVersionState({
				status: "uptodate",
				version: latestTag?.replace(/^v/i, "") || currentVersion,
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : "Unknown error";
			toast.error(t("about.notifications.updateError", { error: message }));
			setLatestVersionState({
				status: "error",
				error: message,
			});
		}
	};

	const handleUpdateEngine = async () => {
		setEngineBusy(true);
		try {
			const next = await orpcClient.engines.update();
			setEngineStatus(next);
			if (next.state === "up-to-date" && next.ytDlpVersion) {
				toast.success(
					t("about.downloadEngine.updated", { version: next.ytDlpVersion }),
				);
				return;
			}
			if (next.error) {
				toast.error(
					t("about.downloadEngine.updateFailed", { error: next.error }),
				);
			}
		} catch (error) {
			toast.error(
				t("about.downloadEngine.updateFailed", {
					error: error instanceof Error ? error.message : "Unknown error",
				}),
			);
		} finally {
			setEngineBusy(false);
		}
	};

	const shareLinks = useMemo(() => {
		const encodedUrl = encodeURIComponent(SHARE_TARGET_URL);
		const encodedText = encodeURIComponent(`${t("about.description")} @nexmoe`);

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
				icon: Mail,
				label: t("about.resources.contact"),
				description: t("about.resources.contactDescription"),
				actionLabel: SUPPORT_EMAIL,
				href: `mailto:${SUPPORT_EMAIL}`,
			},
			{
				icon: LinkIcon,
				label: t("about.resources.website"),
				description: t("about.resources.websiteDescription"),
				actionLabel: t("about.actions.visit"),
				href: "https://vidbee.org/",
				external: true,
			},
			{
				icon: FileText,
				label: t("about.resources.changelog"),
				description: t("about.resources.changelogDescription"),
				actionLabel: t("about.actions.view"),
				href: "https://github.com/nexmoe/VidBee/releases",
				external: true,
			},
		],
		[t],
	);

	return (
		<AppShell page="about">
			<div className="h-full bg-background">
				<div className="container mx-auto max-w-5xl space-y-6 p-6">
					<Card>
						<CardContent className="p-0">
							<div className="space-y-4 px-6 pt-6 pb-4">
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
								{updateDownloadProgress !== null ? (
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
								) : null}
							</div>
							<ItemSeparator />
							{engineStatus ? (
								<DownloadEngineRow
									actions={
										engineStatus.state === "update-available" || engineBusy ? (
											<Button
												className="gap-2"
												disabled={engineBusy}
												onClick={() => void handleUpdateEngine()}
												size="sm"
											>
												<RefreshCw className="h-3.5 w-3.5" />
												{t("about.downloadEngine.update")}
											</Button>
										) : (
											<Button asChild size="sm" variant="outline">
												<a
													href="https://github.com/yt-dlp/yt-dlp/releases"
													rel="noreferrer"
													target="_blank"
												>
													{t("about.resources.changelog")}
												</a>
											</Button>
										)
									}
									status={engineStatus}
									versionsKey="about.downloadEngine.webVersions"
								/>
							) : null}
							{(serverDownloadDir || serverDataDir || serverDbPath) && (
								<>
									<ItemSeparator />
									<div className="space-y-1 px-6 py-3">
										<p className="font-medium leading-none">
											{t("web.storageTitle")}
										</p>
										{serverDownloadDir ? (
											<p className="text-muted-foreground text-sm">
												{t("web.storageDownloadDir")}: {serverDownloadDir}
											</p>
										) : null}
										{serverDataDir ? (
											<p className="text-muted-foreground text-sm">
												{t("web.storageDataDir")}: {serverDataDir}
											</p>
										) : null}
										{serverDbPath ? (
											<p className="text-muted-foreground text-sm">
												{t("web.storageDbFile")}: {serverDbPath}
											</p>
										) : null}
									</div>
								</>
							)}
						</CardContent>
					</Card>

					<div className="grid gap-4 sm:grid-cols-2">
						{OTHER_PRODUCTS.map((product) => (
							<OtherProductCard
								description={t(`about.otherProducts.${product.id}.description`)}
								domain={product.domain}
								href={product.url}
								key={product.id}
								name={t(`about.otherProducts.${product.id}.name`)}
								visitLabel={t("about.actions.visit")}
							/>
						))}
					</div>

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
										onClick={() => openShareUrl("https://x.com/nexmoe")}
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
										<FeedbackLinkButtons
											appInfo={{ appVersion, osVersion }}
											buttonClassName="gap-2"
											iconClassName="h-4 w-4"
											useSimpleGithubUrl={true}
										/>
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
													rel={resource.external ? "noreferrer" : undefined}
													target={resource.external ? "_blank" : undefined}
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
