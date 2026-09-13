import { TanStackDevtools } from "@tanstack/react-devtools";
import { createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import { RemoteImageProvider } from "@vidbee/ui/components/ui/remote-image";
import { ShapeProvider } from "@vidbee/ui/lib/shape-context";
import { useEffect } from "react";
import { Toaster } from "sonner";
import { i18n } from "../lib/i18n";
import { resolveImageProxyUrl } from "../lib/remote-image-proxy";
import { applyThemeToDocument, readWebSettings } from "../lib/web-settings";

import appCss from "../styles.css?url";

export const Route = createRootRoute({
	head: () => ({
		meta: [
			{
				charSet: "utf-8",
			},
			{
				name: "viewport",
				content: "width=device-width, initial-scale=1",
			},
			{
				title: "VidBee Web",
			},
		],
		links: [
			{
				rel: "stylesheet",
				href: appCss,
			},
		],
	}),
	shellComponent: RootDocument,
});

/**
 * App shell: theme/i18n hydration, remote-image proxy, and the page tree.
 */
function RootDocument({ children }: { children: React.ReactNode }) {
	return (
		<html lang="en">
			<head>
				<HeadContent />
			</head>
			<body className="bg-background text-foreground" suppressHydrationWarning>
				<RootHydrationEffects />
				<RemoteImageProvider cacheResolver={resolveImageProxyUrl}>
					<ShapeProvider defaultShape="rounded">{children}</ShapeProvider>
				</RemoteImageProvider>
				<Toaster closeButton={true} richColors={true} />
				<TanStackDevtools
					config={{
						position: "bottom-right",
					}}
					plugins={[
						{
							name: "Tanstack Router",
							render: <TanStackRouterDevtoolsPanel />,
						},
					]}
				/>
				<Scripts />
			</body>
		</html>
	);
}

function RootHydrationEffects() {
	useEffect(() => {
		const settings = readWebSettings();
		applyThemeToDocument(settings.theme);
		void i18n.changeLanguage(settings.language);
	}, []);

	return null;
}
