import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { loadConfigFromFile } from "vite";
import { APP_VERSION } from "../../../api/src/lib/app-version.ts";
import releasePackage from "../../../desktop/package.json" with {
	type: "json",
};

test("API status version matches the release metadata", () => {
	assert.equal(APP_VERSION, releasePackage.version);
});

test("web About fallback version matches the release metadata", async () => {
	const result = await loadConfigFromFile(
		{ command: "build", mode: "production" },
		fileURLToPath(new URL("../../vite.config.ts", import.meta.url)),
	);

	assert.equal(
		result?.config.define?.__APP_VERSION__,
		JSON.stringify(releasePackage.version),
	);
});
