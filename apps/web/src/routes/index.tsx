import { createFileRoute } from "@tanstack/react-router";
import { DownloadPage } from "../components/pages/download-page";

export const Route = createFileRoute("/")({
	component: DownloadPage,
});
