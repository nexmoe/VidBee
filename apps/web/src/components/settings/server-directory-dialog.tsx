import { Button } from "@vidbee/ui/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@vidbee/ui/components/ui/dialog";
import { Input } from "@vidbee/ui/components/ui/input";
import { Folder, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { orpcClient } from "../../lib/orpc-client";

interface ServerDirectoryEntry {
	name: string;
	path: string;
}

interface ServerDirectoryDialogProps {
	open: boolean;
	title: string;
	description: string;
	initialPath?: string;
	onOpenChange: (open: boolean) => void;
	onSelect: (path: string) => void;
}

export const ServerDirectoryDialog = ({
	open,
	title,
	description,
	initialPath,
	onOpenChange,
	onSelect,
}: ServerDirectoryDialogProps) => {
	const { t } = useTranslation();
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [currentPath, setCurrentPath] = useState("");
	const [pathInput, setPathInput] = useState("");
	const [parentPath, setParentPath] = useState<string | null>(null);
	const [directories, setDirectories] = useState<ServerDirectoryEntry[]>([]);

	const loadDirectories = useCallback(
		async (targetPath?: string) => {
			setLoading(true);
			setError(null);
			try {
				const response = await orpcClient.files.listDirectories({
					path: targetPath?.trim() || undefined,
				});
				setCurrentPath(response.currentPath);
				setPathInput(response.currentPath);
				setParentPath(response.parentPath);
				setDirectories(response.directories);
			} catch {
				setError(t("errors.networkError"));
			} finally {
				setLoading(false);
			}
		},
		[t],
	);

	useEffect(() => {
		if (!open) {
			return;
		}
		setPathInput(initialPath ?? "");
		void loadDirectories(initialPath);
	}, [initialPath, loadDirectories, open]);

	const handleSubmitPathInput = () => {
		const targetPath = pathInput.trim();
		if (!targetPath) {
			return;
		}
		void loadDirectories(targetPath);
	};

	const handleSelectCurrent = () => {
		const selectedPath = pathInput.trim() || currentPath.trim();
		if (!selectedPath) {
			return;
		}
		onSelect(selectedPath);
		onOpenChange(false);
	};

	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogContent className="sm:max-w-2xl">
				<DialogHeader>
					<DialogTitle>{title}</DialogTitle>
					<DialogDescription>{description}</DialogDescription>
				</DialogHeader>

				<div className="space-y-3">
					<Input
						onChange={(event) => setPathInput(event.target.value)}
						onKeyDown={(event) => {
							if (event.key !== "Enter") {
								return;
							}
							event.preventDefault();
							handleSubmitPathInput();
						}}
						value={pathInput}
					/>

					<div className="flex items-center gap-2">
						<Button
							disabled={loading || !parentPath}
							onClick={() =>
								parentPath ? void loadDirectories(parentPath) : undefined
							}
							variant="secondary"
						>
							{t("download.back")}
						</Button>
						<Button
							disabled={loading || !pathInput.trim()}
							onClick={handleSubmitPathInput}
							variant="secondary"
						>
							<RefreshCw className="mr-1 h-4 w-4" />
							{t("download.fetch")}
						</Button>
					</div>

					<div className="max-h-64 overflow-auto rounded-md border">
						{loading ? (
							<div className="p-3 text-muted-foreground text-sm">
								{t("download.loading")}
							</div>
						) : null}
						{error ? (
							<div className="p-3 text-destructive text-sm">{error}</div>
						) : null}
						{!(loading || error) && directories.length === 0 ? (
							<div className="p-3 text-muted-foreground text-sm">
								{t("download.noItems")}
							</div>
						) : null}
						{!(loading || error) ? (
							<div className="divide-y">
								{directories.map((directory) => (
									<button
										className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-muted"
										key={directory.path}
										onClick={() => void loadDirectories(directory.path)}
										type="button"
									>
										<Folder className="h-4 w-4 text-muted-foreground" />
										<span className="truncate">{directory.name}</span>
									</button>
								))}
							</div>
						) : null}
					</div>
				</div>

				<DialogFooter>
					<Button onClick={() => onOpenChange(false)} variant="outline">
						{t("download.cancel")}
					</Button>
					<Button
						disabled={loading || !currentPath}
						onClick={handleSelectCurrent}
					>
						{t("settings.selectPath")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
};
