import { useNavigate } from "@tanstack/react-router";
import {
	AppSidebar,
	type AppSidebarItem,
} from "@vidbee/ui/components/ui/app-sidebar";
import { appSidebarIcons } from "@vidbee/ui/components/ui/app-sidebar-icons";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

type AppPage = "about" | "download";

interface AppShellProps {
	children: ReactNode;
	page: AppPage;
}

export const AppShell = ({ children, page }: AppShellProps) => {
	const { t } = useTranslation();
	const navigate = useNavigate();

	const openSupportedSites = () => {
		window.open(
			"https://vidbee.org/supported-sites/",
			"_blank",
			"noopener,noreferrer",
		);
	};

	const items: AppSidebarItem[] = [
		{
			id: "home",
			active: page === "download",
			icon: appSidebarIcons.home,
			label: t("menu.download"),
			onClick: () => {
				void navigate({ to: "/" });
			},
		},
		{
			id: "subscriptions",
			disabled: true,
			icon: appSidebarIcons.subscriptions,
			label: t("menu.rss"),
		},
		{
			id: "supported-sites",
			icon: appSidebarIcons.supportedSites,
			label: t("menu.supportedSites"),
			onClick: openSupportedSites,
		},
	];

	const bottomItems: AppSidebarItem[] = [
		{
			id: "settings",
			disabled: true,
			icon: appSidebarIcons.settings,
			label: t("menu.preferences"),
			showLabel: false,
			showTooltip: true,
		},
		{
			id: "about",
			active: page === "about",
			icon: appSidebarIcons.about,
			label: t("menu.about"),
			onClick: () => {
				void navigate({ to: "/about" });
			},
			showLabel: false,
			showTooltip: true,
		},
	];

	return (
		<div className="flex h-screen flex-row">
			<AppSidebar
				appName="VidBee"
				bottomItems={bottomItems}
				items={items}
				logoAlt="VidBee"
				logoSrc="/app-icon.png"
			/>

			<main className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
				<div className="h-full flex-1 overflow-y-auto overflow-x-hidden">
					{children}
				</div>
			</main>
		</div>
	);
};
