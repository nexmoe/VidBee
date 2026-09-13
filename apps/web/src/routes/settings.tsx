import { createFileRoute } from "@tanstack/react-router";
import { SettingsPage } from "../components/pages/settings-page";

export const Route = createFileRoute("/settings")({
	component: SettingsPage,
	validateSearch: (search: Record<string, unknown>): { tab?: string } => ({
		tab: typeof search.tab === "string" ? search.tab : undefined,
	}),
});
