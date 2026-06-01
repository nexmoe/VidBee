import { isPlaylistLikeUrl } from "@vidbee/ui/lib/url-kind";
import { describe, expect, it } from "vitest";

describe("isPlaylistLikeUrl", () => {
	it("treats YouTube watch links with list params as single videos", () => {
		expect(
			isPlaylistLikeUrl("https://youtu.be/slrYtQbP6p4?list=RDslrYtQbP6p4"),
		).toBe(false);
		expect(
			isPlaylistLikeUrl("https://www.youtube.com/watch?v=slrYtQbP6p4&list=RDslrYtQbP6p4"),
		).toBe(false);
	});

	it("treats YouTube playlist pages as playlists", () => {
		expect(
			isPlaylistLikeUrl("https://www.youtube.com/playlist?list=PL1234567890"),
		).toBe(true);
	});

	it("keeps generic playlist query params playlist-like", () => {
		expect(isPlaylistLikeUrl("https://example.com/watch?list=abc")).toBe(true);
	});
});
