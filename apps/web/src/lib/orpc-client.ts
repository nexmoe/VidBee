import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { ContractRouterClient } from "@orpc/contract";
import type { downloaderContract } from "@vidbee/downloader-core";

const configuredApiUrl = import.meta.env.VITE_API_URL?.trim();
const normalizedApiUrl = configuredApiUrl
	? configuredApiUrl.replace(/\/+$/, "")
	: "";
const defaultOrigin =
	typeof window === "undefined"
		? "http://localhost:3000"
		: window.location.origin;
export const apiUrl = normalizedApiUrl || defaultOrigin;

export const eventsUrl = `${apiUrl}/events`;
const rpcUrl = `${apiUrl}/rpc`;

export const orpcClient: ContractRouterClient<typeof downloaderContract> =
	createORPCClient(
		new RPCLink({
			url: rpcUrl,
		}),
	);
