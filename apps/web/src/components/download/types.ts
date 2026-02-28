import type { DownloadTask } from "@vidbee/downloader-core";

export type DownloadRecord = DownloadTask & {
	entryType: "active" | "history";
};

export type StatusFilter = "all" | "active" | "completed" | "error";
