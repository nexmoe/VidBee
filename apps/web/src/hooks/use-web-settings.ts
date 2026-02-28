import { useCallback, useEffect, useMemo, useState } from "react";
import { i18n } from "../lib/i18n";
import { orpcClient } from "../lib/orpc-client";
import {
	applyThemeToDocument,
	defaultWebSettings,
	readWebSettings,
	WEB_SETTINGS_STORAGE_KEY,
	type WebAppSettings,
	writeWebSettings,
} from "../lib/web-settings";

export const useWebSettings = () => {
	const [settings, setSettings] = useState<WebAppSettings>(() => {
		if (typeof window === "undefined") {
			return defaultWebSettings;
		}
		return readWebSettings();
	});
	const [remoteReady, setRemoteReady] = useState(false);

	useEffect(() => {
		writeWebSettings(settings);
	}, [settings]);

	useEffect(() => {
		let disposed = false;

		const loadRemoteSettings = async () => {
			try {
				const result = await orpcClient.settings.get();
				if (disposed) {
					return;
				}
				setSettings(result.settings);
			} catch {
				// Keep local settings as fallback when API is unavailable.
			} finally {
				if (!disposed) {
					setRemoteReady(true);
				}
			}
		};

		void loadRemoteSettings();

		return () => {
			disposed = true;
		};
	}, []);

	useEffect(() => {
		if (!remoteReady) {
			return;
		}

		const timeoutId = window.setTimeout(() => {
			void orpcClient.settings.set({ settings }).catch(() => {
				// Keep local settings as fallback when API save fails.
			});
		}, 200);

		return () => {
			window.clearTimeout(timeoutId);
		};
	}, [remoteReady, settings]);

	useEffect(() => {
		applyThemeToDocument(settings.theme);
	}, [settings.theme]);

	useEffect(() => {
		void i18n.changeLanguage(settings.language);
	}, [settings.language]);

	useEffect(() => {
		const onStorage = (event: StorageEvent) => {
			if (event.storageArea !== window.localStorage) {
				return;
			}
			if (event.key !== WEB_SETTINGS_STORAGE_KEY) {
				return;
			}
			setSettings(readWebSettings());
		};

		window.addEventListener("storage", onStorage);
		return () => {
			window.removeEventListener("storage", onStorage);
		};
	}, []);

	const updateSettings = useCallback((updates: Partial<WebAppSettings>) => {
		setSettings((prev) => ({ ...prev, ...updates }));
	}, []);

	const replaceSettings = useCallback((nextSettings: WebAppSettings) => {
		setSettings(nextSettings);
	}, []);

	return useMemo(
		() => ({
			settings,
			updateSettings,
			replaceSettings,
		}),
		[settings, updateSettings, replaceSettings],
	);
};
