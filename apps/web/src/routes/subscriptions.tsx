import { createFileRoute } from "@tanstack/react-router";
import { SubscriptionsPage } from "../components/pages/subscriptions-page";

export const Route = createFileRoute("/subscriptions")({
	component: SubscriptionsPage,
});
