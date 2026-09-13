import {
	COOKIES_CHROME_EXTENSION_URL,
	COOKIES_FIREFOX_EXTENSION_URL,
	COOKIES_GUIDE_URL,
	hasConfiguredCookieSettings,
} from "@vidbee/downloader-core/cookie-setup";
import { Button } from "@vidbee/ui/components/ui/button";
import { Input } from "@vidbee/ui/components/ui/input";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemTitle,
} from "@vidbee/ui/components/ui/item";
import { Cookie } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { WebAppSettings } from "../../lib/web-settings";

interface CookiesSetupSectionProps {
	settings: WebAppSettings;
	updateSettings: (updates: Partial<WebAppSettings>) => void;
	onSelectCookiesFile: () => void;
	cookiesFileUploading: boolean;
}

/**
 * Self-hosted cookies setup: Netscape cookies.txt upload only.
 */
export const CookiesSetupSection = ({
	settings,
	updateSettings,
	onSelectCookiesFile,
	cookiesFileUploading,
}: CookiesSetupSectionProps) => {
	const { t } = useTranslation();
	const configured = hasConfiguredCookieSettings("none", settings.cookiesPath);

	const handleOpenLink = (url: string): void => {
		if (typeof window === "undefined") {
			return;
		}
		window.open(url, "_blank", "noopener,noreferrer");
	};

	return (
		<div className="space-y-4">
			<ItemGroup>
				<Item variant="muted">
					<ItemContent>
						<div className="flex flex-wrap items-center gap-2">
							<Cookie className="h-4 w-4 text-muted-foreground" />
							<ItemTitle>
								{configured
									? t("settings.cookiesSetup.statusUsingFile")
									: t("settings.cookiesSetup.statusNotConfigured")}
							</ItemTitle>
						</div>
						<ItemDescription>
							{configured
								? t("settings.cookiesSetup.healthOkFileGeneric")
								: t("web.cookiesFileOnly")}
						</ItemDescription>
					</ItemContent>
					<ItemActions>
						{configured ? (
							<Button
								onClick={() =>
									updateSettings({
										browserForCookies: "none",
										cookiesPath: "",
									})
								}
								size="sm"
								variant="secondary"
							>
								{t("settings.cookiesSetup.clearSetup")}
							</Button>
						) : null}
					</ItemActions>
				</Item>
			</ItemGroup>

			<ItemGroup>
				<Item variant="muted">
					<ItemContent>
						<ItemTitle>{t("settings.cookiesFile")}</ItemTitle>
						<ItemDescription>{t("web.cookiesFileOnly")}</ItemDescription>
						<div className="flex flex-wrap gap-3 pt-1">
							<Button
								className="px-0"
								onClick={() => handleOpenLink(COOKIES_CHROME_EXTENSION_URL)}
								variant="link"
							>
								{t("settings.cookiesSetup.fileExportExtension")}
							</Button>
							<Button
								className="px-0"
								onClick={() => handleOpenLink(COOKIES_FIREFOX_EXTENSION_URL)}
								variant="link"
							>
								{t("settings.browserOptions.firefox")}
							</Button>
						</div>
					</ItemContent>
					<ItemActions>
						<div className="flex w-full max-w-md gap-2">
							<Input className="flex-1" readOnly value={settings.cookiesPath} />
							<Button
								disabled={cookiesFileUploading}
								onClick={onSelectCookiesFile}
							>
								{cookiesFileUploading
									? t("download.loading")
									: t("settings.selectPath")}
							</Button>
						</div>
					</ItemActions>
				</Item>
			</ItemGroup>

			<ItemGroup>
				<Item variant="muted">
					<ItemContent>
						<ItemTitle>{t("settings.cookiesGuideTitle")}</ItemTitle>
						<ItemDescription>
							{t("settings.cookiesGuideDescription")}
						</ItemDescription>
					</ItemContent>
					<ItemActions>
						<Button
							className="px-0"
							onClick={() => handleOpenLink(COOKIES_GUIDE_URL)}
							variant="link"
						>
							{t("settings.cookiesGuideLink")}
						</Button>
					</ItemActions>
				</Item>
			</ItemGroup>
		</div>
	);
};
