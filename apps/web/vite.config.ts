import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import Icons from "unplugin-icons/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";
import packageJson from "./package.json" with { type: "json" };

const apiProxyTarget =
	process.env.VIDBEE_API_URL_INTERNAL?.trim() || "http://localhost:3100";

// Self-hosters behind a reverse proxy (e.g. Traefik) must allow their domain
// in Vite's host check (GitHub issue #404). VIDBEE_ALLOWED_HOSTS="*" (or "all")
// disables the check; a comma-separated list allows specific hosts; unset keeps
// Vite's secure localhost default.
function resolveAllowedHosts(): true | string[] | undefined {
	const raw = process.env.VIDBEE_ALLOWED_HOSTS?.trim();
	if (!raw) {
		return undefined;
	}
	if (raw === "*" || raw === "all") {
		return true;
	}
	return raw
		.split(",")
		.map((host) => host.trim())
		.filter(Boolean);
}

const reactSsrDeps = [
	"react",
	"react-dom",
	"react/jsx-runtime",
	"react/jsx-dev-runtime",
	"react-dom/server",
];

const config = defineConfig(({ command }) => ({
	define: {
		__APP_VERSION__: JSON.stringify(packageJson.version),
	},
	legacy: {
		inconsistentCjsInterop: true,
	},
	optimizeDeps: {
		include: reactSsrDeps,
	},
	plugins: [
		devtools({
			eventBusConfig: {
				enabled: false,
			},
		}),
		tsconfigPaths({ projects: ["./tsconfig.json"] }),
		Icons({
			compiler: "jsx",
			jsx: "react",
		}),
		tailwindcss(),
		tanstackStart(),
		viteReact(),
	],
	server: {
		...(process.env.PORTLESS_URL
			? { host: "127.0.0.1", port: Number(process.env.PORT), strictPort: true }
			: {}),
		allowedHosts: resolveAllowedHosts(),
		proxy: {
			"/events": {
				target: apiProxyTarget,
				changeOrigin: true,
			},
			"/files": {
				target: apiProxyTarget,
				changeOrigin: true,
			},
			"/rpc": {
				target: apiProxyTarget,
				changeOrigin: true,
			},
			"/images": {
				target: apiProxyTarget,
				changeOrigin: true,
			},
		},
	},
	ssr: {
		// Vite 8's module runner evaluates unoptimized CJS as ESM. Bundle CJS
		// only in production; in dev let Node load those packages natively.
		...(command === "build" ? { noExternal: true as const } : {}),
		optimizeDeps: {
			include: reactSsrDeps,
		},
	},
}));

export default config;
